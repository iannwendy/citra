import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowRight,
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
  RefreshCw,
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
import {
  formatLocalizedDateTime,
  formatUserError,
  getVerdictDisplay,
  resolveAcademicLang,
  type CanonicalVerdictKey,
} from '@/lib/academicTaxonomy';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  StudioWindowHeader,
  ProportionalBarRow,
} from '@/components/ui/studio-visuals';
import {
  AccordionExpand,
  DonutChart,
  NumberPopIn,
  SymmetricChevron,
} from '@/components/ui/transitions';

type HealthLevel = 'healthy' | 'degraded' | 'down';

const HEALTHY_WORDS = new Set(['ok', 'healthy', 'up', 'alive', 'ready', 'pass']);

const VERDICT_COLOR_HEX: Record<CanonicalVerdictKey, string> = {
  verified: '#10b981',
  metadata_error: '#f59e0b',
  suspected_hallucination: '#ef4444',
  resource: '#8b5cf6',
  unresolved: '#64748b',
};

const CACHE_STAT_LABELS: Record<string, { en: string; vi: string }> = {
  total: { en: 'Total Cached Entries', vi: 'Tổng mục lưu đệm' },
  total_hits: { en: 'Total Cache Reuses', vi: 'Tổng lượt tái sử dụng đệm' },
  avg_hit_count: { en: 'Avg Reuses / Entry', vi: 'Trung bình tái sử dụng / mục' },
  dynamic_entries: { en: 'Temporary Cached Entries', vi: 'Mục lưu đệm tạm' },
  local_papers_count: { en: 'Built-in Library Papers', vi: 'Bài báo thư viện tích hợp' },
  local_queries_count: { en: 'Built-in Library Queries', vi: 'Lượt tra cứu thư viện tích hợp' },
  local_hits_count: { en: 'Built-in Library Matches', vi: 'Lượt khớp thư viện tích hợp' },
  local_hit_rate_percent: {
    en: 'Built-in Library Match Rate (%)',
    vi: 'Tỷ lệ khớp thư viện tích hợp (%)',
  },
  persistent_entries: {
    en: 'Saved Disk Cache Entries',
    vi: 'Mục lưu đệm trên ổ đĩa',
  },
  expired_entries: { en: 'Expired Cache Entries', vi: 'Mục lưu đệm đã hết hạn' },
  persistent_hits: {
    en: 'Disk Cache Reuses',
    vi: 'Lượt tái sử dụng từ ổ đĩa',
  },
  hit_rate_percent: { en: 'Cache Reuse Rate (%)', vi: 'Tỷ lệ tái sử dụng đệm (%)' },
  session_hits: {
    en: 'Session Cache Hits',
    vi: 'Lượt khớp đệm phiên hiện tại',
  },
  session_misses: {
    en: 'Session Cache Misses',
    vi: 'Lượt chưa có trong đệm',
  },
  session_hit_rate_percent: {
    en: 'Session Cache Hit Rate (%)',
    vi: 'Tỷ lệ khớp đệm phiên (%)',
  },
  wave0_entries: { en: 'Preloaded Records', vi: 'Dữ liệu khởi động sẵn' },
  negative_cache_entries: {
    en: 'Empty-Result Cache',
    vi: 'Đệm kết quả trống',
  },
  singleflight_coalesced: {
    en: 'Deduplicated Requests',
    vi: 'Yêu cầu gộp trùng',
  },
};

const SERVICE_DISPLAY_LABELS: Record<string, { en: string; vi: string }> = {
  grobid: { en: 'Enhanced PDF Parser', vi: 'Bộ đọc PDF chuyên sâu' },
  database: { en: 'Database', vi: 'Cơ sở dữ liệu' },
  db: { en: 'Database', vi: 'Cơ sở dữ liệu' },
  cache: { en: 'Lookup Cache', vi: 'Bộ nhớ đệm' },
  parser: { en: 'Document Parser', vi: 'Bộ đọc tài liệu' },
  redis: { en: 'Session Cache', vi: 'Bộ nhớ đệm phiên' },
  upstream: { en: 'Academic Sources', vi: 'Nguồn học thuật' },
};

function formatServiceName(key: string, lang: 'en' | 'vi'): string {
  const normalized = key.trim().toLowerCase();
  const mapped = SERVICE_DISPLAY_LABELS[normalized];
  if (mapped) return mapped[lang];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

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
  doi_ra: { en: 'Global DOI Registry', vi: 'Hệ thống đăng ký DOI' },
  doaj: 'DOAJ',
  openaire_hal: 'OpenAIRE / HAL',
  ncbi_biorxiv: 'NCBI / bioRxiv',
  huggingface: 'Hugging Face',
  tech_standard: {
    en: 'Tech Standards',
    vi: 'Tiêu chuẩn kỹ thuật',
  },
  vn_tech_standard: {
    en: 'VN Tech Standards (TCVN/QCVN)',
    vi: 'Tiêu chuẩn kỹ thuật VN (TCVN/QCVN)',
  },
  vn_textbook_registry: {
    en: 'VN Textbook Registry',
    vi: 'Danh mục giáo trình ĐH VN',
  },
  vn_legal_registry: {
    en: 'Vietnamese Legal Database',
    vi: 'Cơ sở dữ liệu Pháp luật VN',
  },
  web_html_meta: { en: 'Web Page Metadata', vi: 'Thông tin trang web' },
  wayback_html_meta: {
    en: 'Wayback Machine Archive',
    vi: 'Lưu trữ Wayback Machine',
  },
  wikidata_opencitations: 'Wikidata / OpenCitations',
  wikidata_opencitatio: 'Wikidata / OpenCitations',
  url_check: { en: 'URL Check', vi: 'Kiểm chứng URL' },
  clean_miss: {
    en: 'Confirmed No Match',
    vi: 'Đã kiểm tra — không tìm thấy bản ghi',
  },
  serpapi: {
    en: 'Google Scholar (supplemental index)',
    vi: 'Google Scholar (chỉ mục bổ sung)',
  },
  acl: 'ACL Anthology',
  coreapi: 'CORE',
  vn_registry: {
    en: 'VN Academic Registry',
    vi: 'Danh mục học thuật VN',
  },
  html_head: {
    en: 'Web Metadata Checker',
    vi: 'Trình đọc thông tin trang web',
  },
  local_db: {
    en: 'CITRA Scholarly Library',
    vi: 'Thư viện học thuật CITRA',
  },
  known_papers: {
    en: 'Curated Known Papers',
    vi: 'Danh mục bài báo chuẩn',
  },
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

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return '0 ms';
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${formatMetricNumber(ms)} ms`;
}

function formatIntCounter(val: number, lang: 'en' | 'vi'): string {
  if (!Number.isFinite(val)) return '0';
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  return Math.round(val).toLocaleString(locale);
}

function formatStatCellValue(val: unknown, lang: 'en' | 'vi'): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
    return Number.isInteger(val)
      ? val.toLocaleString(locale)
      : val.toLocaleString(locale, { maximumFractionDigits: 2 });
  }
  return String(val ?? '—');
}

function sanitizeUpstreamError(
  raw: string | null | undefined,
  lang: 'en' | 'vi',
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Catch raw Python RetryError / Future pointer leaks or stack trace frames
  if (
    /RetryError\s*\[|<Future\s+at\s+0x|0x[0-9a-f]{6,}|Traceback\s*\(/i.test(
      trimmed,
    )
  ) {
    if (/timeout|timed\s*out/i.test(trimmed)) {
      return lang === 'vi'
        ? 'Hết thời gian phản hồi từ nguồn ngoài'
        : 'Upstream request timed out';
    }
    return lang === 'vi'
      ? 'Kết nối nguồn gặp lỗi sau nhiều lần thử lại'
      : 'Upstream request failed after retries';
  }

  // Translate common raw Python/HTTP client exception messages into clean ops language
  if (
    /ReadTimeout|ConnectTimeout|PoolTimeout|TimeoutException|timeout\s*\(|timed\s*out/i.test(
      trimmed,
    )
  ) {
    return lang === 'vi'
      ? 'Hết thời gian phản hồi từ nguồn ngoài'
      : 'Upstream request timed out';
  }
  if (/rate\s*limit|too\s+many\s+requests|\b429\b/i.test(trimmed)) {
    return lang === 'vi'
      ? 'Nguồn tạm giới hạn tốc độ truy vấn'
      : 'Temporarily rate-limited by upstream source';
  }
  if (
    /\b(?:http\s*)?5\d{2}\b|gateway\s*timeout|bad\s*gateway|service\s*unavailable/i.test(
      trimmed,
    )
  ) {
    return lang === 'vi'
      ? 'Máy chủ nguồn tạm thời gặp lỗi'
      : 'Upstream server temporarily unavailable';
  }
  if (
    /ConnectError|RemoteProtocolError|TLS|SSL|connection\s+reset|reset\s+by\s+peer/i.test(
      trimmed,
    )
  ) {
    return lang === 'vi'
      ? 'Kết nối tới nguồn ngoài bị gián đoạn'
      : 'Connection to upstream source interrupted';
  }

  // Strip leaked query strings / URL parameters / quoted search queries
  const cleaned = trimmed
    .replace(/(?:for\s+url|url=|query=)\s*['"][^'"]*['"]/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/['"][^'"]{24,}['"]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned) {
    return lang === 'vi'
      ? 'Nguồn tạm thời phản hồi lỗi'
      : 'Upstream source returned an error';
  }

  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}

function formatSqliteSyncMode(raw: unknown, lang: 'en' | 'vi'): string {
  const normalized =
    raw === 0 || raw === '0'
      ? 'OFF'
      : raw === 1 || raw === '1'
        ? 'NORMAL'
        : raw === 2 || raw === '2'
          ? 'FULL'
          : raw === 3 || raw === '3'
            ? 'EXTRA'
            : typeof raw === 'string' && raw.trim()
              ? raw.trim().toUpperCase()
              : 'NORMAL';
  if (lang === 'vi') {
    if (normalized === 'NORMAL') return 'Tiêu chuẩn (NORMAL)';
    if (normalized === 'FULL') return 'Đầy đủ (FULL)';
    if (normalized === 'OFF') return 'Tắt (OFF)';
    if (normalized === 'EXTRA') return 'Tối đa (EXTRA)';
  }
  return normalized;
}

function formatLocalPapersDbMode(
  localDb: Record<string, unknown> | null | undefined,
  lang: 'en' | 'vi',
): string {
  if (!localDb || typeof localDb !== 'object') {
    return lang === 'vi'
      ? 'Thư viện học thuật CITRA (Chưa kết nối)'
      : 'CITRA Scholarly Library (Not Connected)';
  }
  if (localDb.available === false) {
    return lang === 'vi'
      ? 'Thư viện học thuật CITRA (Chưa sẵn sàng)'
      : 'CITRA Scholarly Library (Unavailable)';
  }
  const modeStr = typeof localDb.mode === 'string' ? localDb.mode.trim().toLowerCase() : '';
  const isReadOnly =
    localDb.read_only === true ||
    localDb.query_only === true ||
    localDb.query_only === 1 ||
    modeStr.includes('ro') ||
    modeStr.includes('read');
  if (isReadOnly) {
    return lang === 'vi'
      ? 'Thư viện học thuật CITRA (Chỉ đọc)'
      : 'CITRA Scholarly Library (Read-Only)';
  }
  return lang === 'vi'
    ? 'Thư viện học thuật CITRA (Đã kết nối)'
    : 'CITRA Scholarly Library (Connected)';
}

function isProviderDegraded(info: UpstreamSourceHealth): boolean {
  const state = String(info.state ?? 'closed').trim().toLowerCase();
  if (state !== 'closed') return true;
  const totalCalls = Number(info.total_calls ?? 0);
  const successCount = Number(info.success_count ?? 0);
  const consecutiveFailures = Number(info.consecutive_failures ?? 0);
  if (consecutiveFailures >= 2) return true;
  if (totalCalls >= 3 && successCount / totalCalls < 0.8) return true;
  return false;
}

function getProviderVisuals(
  state: CircuitBreakerState,
  degradedWhileClosed: boolean,
  lang: 'en' | 'vi',
): {
  label: string;
  tooltip: string;
  pillClass: string;
  dotClass: string;
} {
  if (state === 'open') {
    return {
      label: lang === 'vi' ? 'Tạm ngắt' : 'Paused',
      tooltip:
        lang === 'vi'
          ? 'Tạm ngưng gọi nguồn này do lỗi liên tiếp — sẽ tự động kiểm tra lại khi hết thời gian chờ'
          : 'Temporarily paused after consecutive errors — will automatically re-probe after cooldown',
      pillClass:
        'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/70 text-rose-700 dark:text-rose-300',
      dotClass: 'bg-rose-500 animate-pulse',
    };
  }
  if (state === 'half_open') {
    return {
      label: lang === 'vi' ? 'Đang kiểm tra lại' : 'Recovering',
      tooltip:
        lang === 'vi'
          ? 'Đang gửi yêu cầu kiểm tra lại để xác nhận nguồn học thuật đã hoạt động ổn định'
          : 'Probing upstream source to verify recovery',
      pillClass:
        'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/70 text-amber-800 dark:text-amber-300',
      dotClass: 'bg-amber-500 animate-pulse',
    };
  }
  if (degradedWhileClosed) {
    return {
      label: lang === 'vi' ? 'Không ổn định' : 'Unstable',
      tooltip:
        lang === 'vi'
          ? 'Nguồn đang kết nối nhưng tỷ lệ thành công dưới 80% hoặc có lỗi liên tiếp'
          : 'Source is reachable but success rate is below 80% or experiencing errors',
      pillClass:
        'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/70 text-amber-800 dark:text-amber-300',
      dotClass: 'bg-amber-500',
    };
  }
  return {
    label: lang === 'vi' ? 'Đang hoạt động' : 'Operational',
    tooltip:
      lang === 'vi'
        ? 'Nguồn học thuật đang kết nối và phản hồi ổn định'
        : 'Upstream scholarly API is operating normally',
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
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const toast = useToast();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [resettingBreaker, setResettingBreaker] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const load = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    }
    try {
      const next = await api.getSystemHealth();
      setData(next);
      setFetchedAt(next.checked_at ?? new Date().toISOString());
      setError('');
    } catch (e) {
      setError(formatUserError(e, lang));
    } finally {
      if (isManualRefresh) {
        setRefreshing(false);
      }
    }
  }, [lang]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const handleResetBreaker = async (source?: string) => {
    const key = source ?? '__all__';
    setResettingBreaker(key);
    try {
      if (typeof api.resetCircuitBreaker === 'function') {
        await api.resetCircuitBreaker(source);
      }
      toast.success(
        lang === 'vi'
          ? 'Đã khôi phục kết nối nguồn'
          : 'Source connection restored',
        source
          ? lang === 'vi'
            ? `Đã kết nối lại nguồn ${formatProviderName(source, lang)}.`
            : `Reconnected ${formatProviderName(source, lang)}.`
          : lang === 'vi'
            ? 'Đã kết nối lại các nguồn đang tạm ngắt'
            : 'Reconnected all paused sources',
      );
      await load(false);
    } catch (e) {
      toast.error(
        lang === 'vi'
          ? 'Không thể kết nối lại nguồn'
          : 'Could not reconnect source',
        formatUserError(e, lang),
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
          ? `Đã xóa ${formatIntCounter(res.deleted_count, lang)} mục khỏi bộ nhớ đệm tra cứu.`
          : `Removed ${formatIntCounter(res.deleted_count, lang)} cached lookup entries.`,
      );
      await load(false);
    } catch (e) {
      toast.error(
        lang === 'vi' ? 'Không thể xóa bộ nhớ đệm' : 'Failed to clear cache',
        formatUserError(e, lang),
      );
    } finally {
      setClearing(false);
    }
  };

  if (error && !data) {
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
  const coreHealth = summarizeHealth(data);

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

  const degradedSourceSet = new Set<string>(data.degraded_sources ?? []);
  for (const [srcKey, info] of upstreamEntries) {
    if (isProviderDegraded(info)) {
      degradedSourceSet.add(srcKey);
    }
  }
  const degradedUpstreamCount = degradedSourceSet.size;
  const totalUpstreamCount = upstreamEntries.length;
  const healthyUpstreamCount = Math.max(
    0,
    totalUpstreamCount - degradedUpstreamCount,
  );
  const degradedClosedCount = Math.max(
    0,
    degradedUpstreamCount - openCircuitsCount - halfOpenCircuitsCount,
  );

  const isUpstreamDegraded =
    normalizeLevel(data.upstream_status ?? 'ok') !== 'healthy' ||
    degradedUpstreamCount > 0;

  const effectiveLevel: HealthLevel =
    coreHealth.level === 'down'
      ? 'down'
      : coreHealth.level === 'degraded' || isUpstreamDegraded
        ? 'degraded'
        : 'healthy';

  const pillTone =
    effectiveLevel === 'healthy'
      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
      : effectiveLevel === 'degraded'
        ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200/70 dark:border-amber-800/70 text-amber-800 dark:text-amber-300'
        : 'bg-red-50 dark:bg-red-950/70 border-red-200/70 dark:border-red-800/70 text-red-700 dark:text-red-300';
  const dotTone =
    effectiveLevel === 'healthy'
      ? 'bg-emerald-500'
      : effectiveLevel === 'degraded'
        ? 'bg-amber-500'
        : 'bg-red-500';
  const degradedList = coreHealth.degradedServices
    .map((svc) => formatServiceName(svc, lang))
    .join(', ');

  let pillText: string;
  if (effectiveLevel === 'healthy') {
    pillText =
      lang === 'vi' ? 'Tất cả dịch vụ ổn định' : 'All Services Healthy';
  } else if (effectiveLevel === 'degraded') {
    if (coreHealth.degradedServices.length > 0) {
      pillText =
        lang === 'vi'
          ? `Tạm suy giảm: ${degradedList}`
          : `Degraded: ${degradedList}`;
    } else if (degradedUpstreamCount > 0 && totalUpstreamCount > 0) {
      pillText =
        lang === 'vi'
          ? `${degradedUpstreamCount} nguồn không ổn định (${healthyUpstreamCount}/${totalUpstreamCount} hoạt động tốt)`
          : `${degradedUpstreamCount} ${degradedUpstreamCount === 1 ? 'source' : 'sources'} unstable (${healthyUpstreamCount}/${totalUpstreamCount} operational)`;
    } else {
      pillText = lang === 'vi' ? 'Hệ thống tạm suy giảm' : 'System Degraded';
    }
  } else {
    pillText =
      lang === 'vi'
        ? `Hệ thống gián đoạn${degradedList ? `: ${degradedList}` : ''}`
        : `Service outage${degradedList ? `: ${degradedList}` : ''}`;
  }

  // Stage 1: live Database & GROBID status pills
  const rawDbSvc = data.services?.database;
  const dbHealthy =
    normalizeLevel(
      typeof rawDbSvc === 'string' ? rawDbSvc : (rawDbSvc?.status ?? 'ok'),
    ) === 'healthy';

  const rawGrobidSvc = data.services?.grobid;
  const grobidSvcDegraded =
    rawGrobidSvc != null &&
    normalizeLevel(
      typeof rawGrobidSvc === 'string' ? rawGrobidSvc : rawGrobidSvc?.status,
    ) !== 'healthy';
  const grobidActive =
    data.grobid_available === true ||
    String(data.parser_mode ?? '').toLowerCase() === 'grobid';

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

  const rawCacheHitRate =
    rawCacheStats.hit_rate_percent ??
    rawCacheStats.local_hit_rate_percent ??
    rawCacheStats.session_hit_rate_percent;
  const cacheHitRatePct =
    rawCacheHitRate != null && Number.isFinite(Number(rawCacheHitRate))
      ? Math.min(100, Math.max(0, Number(rawCacheHitRate)))
      : 0;
  const totalCacheLookups =
    Number(rawCacheStats.local_queries_count ?? 0) +
    Number(rawCacheStats.session_hits ?? 0) +
    Number(rawCacheStats.session_misses ?? 0) +
    Number(rawCacheStats.total_hits ?? 0) +
    Number(rawCacheStats.persistent_hits ?? 0);
  const hasCacheHitRateSample =
    rawCacheHitRate != null &&
    Number.isFinite(Number(rawCacheHitRate)) &&
    (cacheHitRatePct > 0 || totalCacheLookups > 0);
  const stage3RingSize = 54;
  const stage3RingThickness = 4.5;
  const stage3RingCenter = stage3RingSize / 2;
  const stage3RingRadius = (stage3RingSize - stage3RingThickness) / 2 - 0.5;
  const stage3RingCircumference = 2 * Math.PI * stage3RingRadius;
  const stage3RingValue = hasCacheHitRateSample ? cacheHitRatePct : 0;
  const stage3RingDashOffset =
    stage3RingCircumference * (1 - stage3RingValue / 100);
  const stage3HitRateDisplay = hasCacheHitRateSample
    ? `${Math.round(cacheHitRatePct)}%`
    : '—';

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

  const verdictEntries = Object.entries(data.verdict_label_counts ?? {});
  const rawVerdictSum = verdictEntries.reduce((acc, [, c]) => acc + c, 0);

  const lastCheckedIso = data.checked_at ?? fetchedAt;
  const formattedCheckedAt = lastCheckedIso
    ? formatLocalizedDateTime(lastCheckedIso, lang)
    : null;

  const grobidTooltip = grobidActive
    ? lang === 'vi'
      ? 'Đang dùng dịch vụ phân tích PDF chuyên sâu (GROBID) để tách cấu trúc tài liệu và trích dẫn.'
      : 'Using the dedicated academic PDF parser (GROBID) for structured citation extraction.'
    : grobidSvcDegraded
      ? lang === 'vi'
        ? 'Dịch vụ phân tích PDF chuyên sâu đang gián đoạn; hệ thống tự động dùng bộ đọc văn bản chuẩn dự phòng.'
        : 'Enhanced PDF parser is temporarily unavailable; automatically using the built-in fallback parser.'
      : lang === 'vi'
        ? 'Đang dùng bộ đọc văn bản chuẩn dự phòng vì dịch vụ phân tích PDF chuyên sâu chưa bật'
        : 'Using the built-in standard text parser because the enhanced PDF analysis service is not enabled';

  const dbTooltip = dbHealthy
    ? lang === 'vi'
      ? 'Cơ sở dữ liệu đang kết nối và phản hồi ổn định.'
      : 'Database is connected and responding normally.'
    : lang === 'vi'
      ? 'Kết nối cơ sở dữ liệu đang gặp sự cố — cần kiểm tra máy chủ.'
      : 'Database connection is experiencing an issue — server inspection required.';

  const pipelineStages: Array<{
    id: string;
    stepLabel: string;
    title: string;
    level: HealthLevel;
    statusText: string;
    icon: React.ReactNode;
    metric: React.ReactNode;
    actionSlot?: React.ReactNode;
  }> = [
    {
      id: 'parser-db',
      stepLabel: lang === 'vi' ? 'Bước 1' : 'Step 1',
      title: lang === 'vi' ? 'Đọc & lưu trữ tài liệu' : 'Document Processing & Storage',
      level: coreHealth.level,
      statusText:
        coreHealth.level === 'healthy'
          ? lang === 'vi'
            ? 'Sẵn sàng'
            : 'Ready'
          : lang === 'vi'
            ? 'Cần kiểm tra'
            : 'Attention',
      icon: <FileCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
      metric: (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <span className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white mr-1.5">
              {formatIntCounter(data.totals.essays, lang)}
            </span>
            {lang === 'vi' ? 'tài liệu đã xử lý' : 'documents analyzed'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-testid="stage1-grobid-pill"
              title={grobidTooltip}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium whitespace-nowrap cursor-help ${
                grobidActive
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300'
                  : grobidSvcDegraded
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200/80 dark:border-amber-800/80 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {grobidActive
                ? lang === 'vi'
                  ? 'Bộ đọc PDF chuyên sâu: Bật'
                  : 'Enhanced PDF Parser: Active'
                : grobidSvcDegraded
                  ? lang === 'vi'
                    ? 'Bộ đọc PDF chuyên sâu: Gián đoạn'
                    : 'Enhanced PDF Parser: Degraded'
                  : lang === 'vi'
                    ? 'Bộ đọc PDF: Dự phòng'
                    : 'PDF Parser: Fallback'}
            </span>
            <span
              data-testid="stage1-db-pill"
              title={dbTooltip}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium whitespace-nowrap cursor-help ${
                dbHealthy
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300'
              }`}
            >
              {dbHealthy
                ? lang === 'vi'
                  ? 'Cơ sở dữ liệu: Ổn định'
                  : 'Database: Connected'
                : lang === 'vi'
                  ? 'Cơ sở dữ liệu: Gián đoạn'
                  : 'Database: Issue'}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'scholarly-network',
      stepLabel: lang === 'vi' ? 'Bước 2' : 'Step 2',
      title: lang === 'vi' ? 'Kết nối thư viện học thuật' : 'Scholarly Library Sources',
      level: isUpstreamDegraded ? 'degraded' : 'healthy',
      statusText: isUpstreamDegraded
        ? lang === 'vi'
          ? `${degradedUpstreamCount} không ổn định`
          : `${degradedUpstreamCount} unstable`
        : lang === 'vi'
          ? 'Thông suốt'
          : 'Connected',
      icon: <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
      metric: (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {totalUpstreamCount > 0 ? (
            <>
              <span
                className={`text-base font-bold font-mono tabular-nums mr-1.5 ${
                  degradedUpstreamCount > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {healthyUpstreamCount}/{totalUpstreamCount}
              </span>
              {lang === 'vi' ? 'nguồn hoạt động tốt' : 'sources operational'}
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
      stepLabel: lang === 'vi' ? 'Bước 3' : 'Step 3',
      title: lang === 'vi' ? 'Bộ nhớ đệm tăng tốc' : 'Lookup Speed Cache',
      level: 'healthy',
      statusText: hasCacheHitRateSample
        ? lang === 'vi'
          ? 'Đang tăng tốc'
          : 'Accelerated'
        : lang === 'vi'
          ? 'Đang chờ dữ liệu'
          : 'Standby',
      icon: <Zap className="h-4 w-4 text-amber-500 dark:text-amber-400" />,
      metric: (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <span className="text-base font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400 mr-1.5">
            {localCorpusPapers > 0
              ? formatIntCounter(localCorpusPapers, lang)
              : formatIntCounter(dynamicCacheEntries, lang)}
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
      actionSlot: (
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div
            data-testid="stage3-hit-rate-ring"
            data-score={stage3RingValue.toFixed(1)}
            role="img"
            aria-label={
              hasCacheHitRateSample
                ? lang === 'vi'
                  ? `Tỷ lệ tái sử dụng bộ nhớ đệm: ${formatMetricNumber(cacheHitRatePct)}%`
                  : `Cache reuse rate: ${formatMetricNumber(cacheHitRatePct)}%`
                : lang === 'vi'
                  ? 'Chưa có lượt tra cứu bộ nhớ đệm'
                  : 'No cache lookups recorded yet'
            }
            title={
              hasCacheHitRateSample
                ? `${formatMetricNumber(cacheHitRatePct)}%`
                : lang === 'vi'
                  ? 'Chưa có lượt tra cứu'
                  : 'No lookups yet'
            }
            className="relative inline-flex items-center justify-center shrink-0"
            style={{ width: stage3RingSize, height: stage3RingSize }}
          >
            <svg
              width={stage3RingSize}
              height={stage3RingSize}
              viewBox={`0 0 ${stage3RingSize} ${stage3RingSize}`}
              className="block"
              aria-hidden="true"
            >
              <circle
                cx={stage3RingCenter}
                cy={stage3RingCenter}
                r={stage3RingRadius}
                fill="none"
                stroke="currentColor"
                className="text-slate-200/80 dark:text-slate-700"
                strokeWidth={stage3RingThickness}
              />
              {stage3RingValue > 0 && (
                <circle
                  data-testid="stage3-hit-rate-ring-progress"
                  cx={stage3RingCenter}
                  cy={stage3RingCenter}
                  r={stage3RingRadius}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={stage3RingThickness}
                  strokeLinecap={stage3RingValue >= 99.5 ? 'butt' : 'round'}
                  strokeDasharray={stage3RingCircumference.toFixed(3)}
                  strokeDashoffset={stage3RingDashOffset.toFixed(3)}
                  transform={`rotate(-90 ${stage3RingCenter} ${stage3RingCenter})`}
                  style={{
                    transition:
                      'stroke-dashoffset 420ms cubic-bezier(0.22, 1, 0.36, 1), stroke 240ms ease',
                  }}
                />
              )}
            </svg>
            <span
              data-testid="stage3-hit-rate-value"
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-bold font-mono tabular-nums leading-none text-slate-900 dark:text-slate-100"
            >
              {stage3HitRateDisplay}
            </span>
          </div>
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {lang === 'vi' ? 'Tái sử dụng đệm' : 'Cache reuse'}
          </span>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* Live System Pulse Header + Responsive 3-Stage Architecture Flow Diagram */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-violet-50 dark:bg-violet-950/80 border border-violet-200/70 dark:border-violet-800/70 flex items-center justify-center shrink-0 mt-0.5">
              <Activity className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('admin.systemHealth')}
                </h1>
                <span
                  data-testid="health-status-pill"
                  data-level={effectiveLevel}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${pillTone}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${dotTone}`}
                  />
                  {pillText}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {lang === 'vi'
                  ? 'Theo dõi trực quan luồng xử lý tài liệu, tốc độ kết nối nguồn học thuật và bộ nhớ tăng tốc.'
                  : 'Visual overview of document processing, scholarly data connections, and lookup speed.'}
              </p>
              {formattedCheckedAt && (
                <p
                  data-testid="health-checked-at"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mt-1.5 font-mono"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {lang === 'vi'
                      ? `Cập nhật lúc: ${formattedCheckedAt}`
                      : `Last checked: ${formattedCheckedAt}`}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void load(true)}
              data-testid="refresh-health-btn"
              className="rounded-xl text-xs gap-1.5 shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              {lang === 'vi' ? 'Làm mới' : 'Refresh'}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clearing}
              onClick={() => setConfirmClearOpen(true)}
              data-testid="clear-cache-btn"
              className="rounded-xl text-xs gap-1.5 shrink-0 cursor-pointer"
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

        {/* Responsive 3-Stage Pipeline Flow (Stacks < xl so Stage 3 never clips on 768px / 1024px) */}
        <div
          data-testid="system-pipeline-flow"
          className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3"
        >
          {pipelineStages.map((stage, idx) => {
            const stageDotClass =
              stage.level === 'healthy'
                ? 'bg-emerald-500'
                : stage.level === 'degraded'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-rose-500 animate-pulse';
            const stagePillClass =
              stage.level === 'healthy'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
                : stage.level === 'degraded'
                  ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/70 text-amber-800 dark:text-amber-300'
                  : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/70 text-rose-700 dark:text-rose-300';

            return (
              <React.Fragment key={stage.id}>
                <div className="relative rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 flex flex-col justify-between gap-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                        {stage.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {stage.stepLabel}
                        </p>
                        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          {stage.title}
                        </h3>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 whitespace-nowrap ${stagePillClass}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageDotClass}`}
                      />
                      {stage.statusText}
                    </span>
                  </div>

                  <div className="flex items-end justify-between gap-3 pt-1">
                    <div className="min-w-0 flex-1">{stage.metric}</div>
                    {stage.actionSlot}
                  </div>
                </div>

                {idx < pipelineStages.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="hidden xl:flex items-center justify-center px-0.5 text-indigo-400 dark:text-indigo-500"
                  >
                    <div className="flex items-center gap-1">
                      <span className="w-3 h-px bg-gradient-to-r from-slate-300 to-indigo-400 dark:from-slate-700 dark:to-indigo-500" />
                      <ArrowRight className="h-4 w-4 animate-pulse" />
                      <span className="w-3 h-px bg-gradient-to-r from-indigo-400 to-slate-300 dark:from-indigo-500 dark:to-slate-700" />
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Compact Platform Scale Strip (grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 prevents 1024px VI truncation) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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
              className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg shrink-0 ${item.box}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-tight">
                  {item.label}
                </span>
              </div>
              <p className={`text-2xl font-bold font-mono tabular-nums ${item.tone}`}>
                <NumberPopIn value={formatIntCounter(item.value, lang)} />
              </p>
            </Card>
          );
        })}
      </div>

      {/* Verdict Distribution Visual Studio (Canonical Non-Accusatory Taxonomy) */}
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
                ? `${formatIntCounter(data.totals.verdicts, lang)} trích dẫn đã kiểm tra`
                : `${formatIntCounter(data.totals.verdicts, lang)} citations checked`}
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
                  ? verdictEntries.map(([label, count]) => {
                      const disp = getVerdictDisplay(label, lang);
                      return {
                        value: count,
                        color: VERDICT_COLOR_HEX[disp.key],
                      };
                    })
                  : [{ value: 1, color: '#cbd5e1' }]
              }
              centerContent={
                <div className="text-center">
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white block leading-none">
                    {formatIntCounter(data.totals.verdicts, lang)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {lang === 'vi' ? 'trích dẫn' : 'citations'}
                  </span>
                </div>
              }
            />
          </div>

          <div className="flex-1 min-w-0 space-y-2.5">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              {lang === 'vi'
                ? 'Phân loại kết quả kiểm chứng'
                : 'Breakdown by verification outcome'}
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
                  const disp = getVerdictDisplay(label, lang);
                  return (
                    <ProportionalBarRow
                      key={label}
                      label={disp.label}
                      count={formatIntCounter(count, lang)}
                      sublabel={`${pct}%`}
                      value={count}
                      max={totalVerdicts}
                      barClass={disp.dotClass}
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
                {totalUpstreamCount === 0
                  ? lang === 'vi'
                    ? '0 nguồn đang chạy'
                    : '0 active sources'
                  : lang === 'vi'
                    ? `${healthyUpstreamCount} hoạt động${
                        degradedClosedCount > 0 ? ` · ${degradedClosedCount} không ổn định` : ''
                      } · ${halfOpenCircuitsCount} kiểm tra lại · ${openCircuitsCount} tạm ngắt`
                    : `${healthyUpstreamCount} operational${
                        degradedClosedCount > 0 ? ` · ${degradedClosedCount} unstable` : ''
                      } · ${halfOpenCircuitsCount} recovering · ${openCircuitsCount} paused`}
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
                    {lang === 'vi'
                      ? 'Kết nối lại nguồn tạm ngắt'
                      : 'Reconnect Paused Sources'}
                  </span>
                </Button>
              )}
            </div>
          }
        />

        <div className="p-4 sm:p-6">
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
            {lang === 'vi'
              ? 'Nguồn học thuật & Bảo vệ kết nối tự động'
              : 'Academic Sources & Connection Protection'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
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
            <>
              {/* Mobile horizontal scroll cue so 4/6 columns never silently vanish on 375px */}
              <div
                data-testid="upstream-mobile-scroll-cue"
                className="md:hidden mb-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60 rounded-lg py-1 px-2.5"
              >
                {lang === 'vi'
                  ? '← Vuốt ngang xem thêm →'
                  : '← Swipe horizontally for more →'}
              </div>

              <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
                <table
                  data-testid="upstream-circuit-table"
                  className="w-full min-w-[680px] text-left border-collapse text-xs"
                >
                  <thead>
                    <tr className="bg-slate-50/90 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <th className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 py-2.5 px-3.5 font-semibold whitespace-nowrap">
                        {lang === 'vi' ? 'Nguồn học thuật' : 'Provider'}
                      </th>
                      <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">
                        {lang === 'vi' ? 'Trạng thái' : 'Status'}
                      </th>
                      <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">
                        {lang === 'vi' ? 'Tốc độ phản hồi' : 'Response Speed'}
                      </th>
                      <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">
                        {lang === 'vi' ? 'Tỷ lệ thành công' : 'Success Rate'}
                      </th>
                      <th
                        title={
                          lang === 'vi'
                            ? 'Số lần nguồn ngoài tạm từ chối do vượt giới hạn số yêu cầu cho phép (HTTP 429)'
                            : 'Times the upstream source temporarily throttled requests (HTTP 429)'
                        }
                        className="py-2.5 px-3.5 font-semibold whitespace-nowrap cursor-help"
                      >
                        {lang === 'vi' ? 'Vượt giới hạn tốc độ' : 'Rate Limited'}
                      </th>
                      <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">
                        {lang === 'vi' ? 'Sự cố kết nối' : 'Connection Errors'}
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
                      const degradedWhileClosed =
                        normalizedState === 'closed' && isProviderDegraded(info);
                      const visuals = getProviderVisuals(
                        normalizedState,
                        degradedWhileClosed,
                        lang,
                      );
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
                      const lastErrorText = sanitizeUpstreamError(
                        info.last_error,
                        lang,
                      );
                      const showLastError =
                        lastErrorText !== null &&
                        (normalizedState !== 'closed' ||
                          consecutiveFailures > 0 ||
                          totalCalls > successCount ||
                          (info.failure_count ?? 0) > 0 ||
                          (info.total_failures ?? 0) > 0);

                      const latencyBarPct = hasLatencySample
                        ? Math.min(
                            100,
                            Math.max(10, Math.round((primaryLatencyMs / 1000) * 100)),
                          )
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
                          className="group hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 py-3 px-3.5 align-middle whitespace-nowrap">
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
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${visuals.pillClass}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${visuals.dotClass}`}
                                />
                                {visuals.label}
                              </span>
                              {normalizedState === 'open' &&
                                openRemainingSeconds >= 0.05 && (
                                  <span
                                    data-testid={`circuit-cooldown-${sourceKey}`}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200/70 dark:border-rose-800/70 text-[10px] font-mono text-rose-700 dark:text-rose-300 whitespace-nowrap"
                                  >
                                    <Clock className="h-3 w-3 shrink-0" />
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
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                                >
                                  {resettingBreaker === sourceKey ? (
                                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-2.5 w-2.5" />
                                  )}
                                  <span>
                                    {lang === 'vi' ? 'Kết nối lại' : 'Reconnect'}
                                  </span>
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
                            className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap"
                          >
                            {hasLatencySample ? (
                              <div className="space-y-1 min-w-[116px]">
                                <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
                                  <span className="whitespace-nowrap">
                                    {formatLatency(primaryLatencyMs)}
                                  </span>
                                  {p95LatencyMs !== null && (
                                    <span
                                      title={
                                        lang === 'vi'
                                          ? '95% số yêu cầu phản hồi nhanh hơn mức thời gian này (p95)'
                                          : '95% of requests complete within this time (p95 latency)'
                                      }
                                      className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap cursor-help"
                                    >
                                      {lang === 'vi'
                                        ? `95% ≤ ${formatLatency(p95LatencyMs)}`
                                        : `p95: ${formatLatency(p95LatencyMs)}`}
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
                            className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap"
                          >
                            {totalCalls === 0 ? (
                              <span className="text-slate-400 dark:text-slate-500">
                                —
                              </span>
                            ) : (
                              <div className="space-y-1 min-w-[100px]">
                                <div className="whitespace-nowrap">
                                  <span>{`${formatIntCounter(successCount, lang)} / ${formatIntCounter(totalCalls, lang)}`}</span>
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
                                          : successRatePct >= 80
                                            ? 'bg-amber-500'
                                            : 'bg-rose-500'
                                      }`}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 align-middle whitespace-nowrap">
                            <span
                              data-testid={`upstream-429-${sourceKey}`}
                              className={`inline-flex items-center px-2 py-0.5 rounded font-mono tabular-nums font-semibold ${
                                http429Count > 0
                                  ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/70'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {formatIntCounter(http429Count, lang)}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>
                                {lang === 'vi'
                                  ? `Chờ quá lâu: ${formatIntCounter(timeoutCount, lang)} · Lỗi máy chủ: ${formatIntCounter(http5xxCount, lang)}`
                                  : `Timeouts: ${formatIntCounter(timeoutCount, lang)} · Server errors: ${formatIntCounter(http5xxCount, lang)}`}
                              </span>
                              {consecutiveFailures > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-rose-600 dark:text-rose-400">
                                  {lang === 'vi'
                                    ? `Lỗi liên tiếp: ${consecutiveFailures}`
                                    : `Consecutive errors: ${consecutiveFailures}`}
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
            </>
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
                        ? 'Bộ nhớ đệm tra cứu tạm'
                        : 'Temporary Lookup Cache'}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 whitespace-nowrap">
                      {lang === 'vi' ? 'Lưu tạm' : 'Live Cache'}
                    </span>
                  </div>
                  <p
                    data-testid="dynamic-cache-entries-value"
                    className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300"
                  >
                    {formatIntCounter(dynamicCacheEntries, lang)}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    {lang === 'vi'
                      ? `${formatIntCounter(persistentHits, lang)} lượt tra cứu khớp từ kho đệm`
                      : `${formatIntCounter(persistentHits, lang)} cached lookup hits`}
                  </p>
                </div>

                <div
                  data-testid="static-local-corpus-card"
                  className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                      {lang === 'vi'
                        ? 'Thư viện học thuật CITRA tích hợp'
                        : 'Built-in CITRA Scholarly Library'}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200 whitespace-nowrap">
                      {lang === 'vi' ? 'Cố định' : 'Built-in'}
                    </span>
                  </div>
                  <p
                    data-testid="static-local-corpus-value"
                    className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-indigo-700 dark:text-indigo-300"
                  >
                    {formatIntCounter(localCorpusPapers, lang)}
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
              <div data-testid="cache-by-source-section" className="pt-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  {lang === 'vi'
                    ? 'Phân bổ dữ liệu đệm theo nguồn'
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
                          count={formatIntCounter(count, lang)}
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
                        ? 'mục lưu đệm tra cứu tạm'
                        : 'temporary cached entries'}
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
                    ? 'Thư viện học thuật tích hợp sẵn'
                    : 'Built-in Scholarly Library'}
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
                        {formatIntCounter(count, lang)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Progressive Disclosure Footer for Granular Cache Counters & Database Settings */}
          <div className="border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <button
              type="button"
              data-testid="toggle-advanced-diagnostics-btn"
              aria-expanded={diagnosticsOpen}
              onClick={() => setDiagnosticsOpen((prev) => !prev)}
              className="w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {lang === 'vi'
                  ? 'Thông số kỹ thuật nâng cao (Dành cho quản trị hạ tầng)'
                  : 'Advanced Diagnostics (Infrastructure Details)'}
              </span>
              <SymmetricChevron
                open={diagnosticsOpen}
                size={15}
                className="text-slate-400"
              />
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
                      className="p-3 rounded-xl bg-violet-50/60 dark:bg-violet-950/25 border border-violet-200/80 dark:border-violet-800/70 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-semibold text-violet-900 dark:text-violet-200">
                        {lang === 'vi'
                          ? 'Bộ nhớ đệm phiên hiện tại'
                          : 'In-Memory Session Cache'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono text-violet-800 dark:text-violet-300">
                        {rawCacheStats.session_hit_rate_percent != null && (
                          <span data-testid="b1-session-hit-rate">
                            {lang === 'vi' ? 'Tỷ lệ khớp' : 'Hit Rate'}:{' '}
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
                            {lang === 'vi'
                              ? 'Dữ liệu khởi động sẵn'
                              : 'Preloaded Records'}
                            :{' '}
                            <strong>
                              {formatIntCounter(
                                Number(rawCacheStats.wave0_entries),
                                lang,
                              )}
                            </strong>
                          </span>
                        )}
                        {rawCacheStats.singleflight_coalesced != null && (
                          <span data-testid="b1-singleflight-coalesced">
                            {lang === 'vi'
                              ? 'Yêu cầu gộp trùng'
                              : 'Deduplicated Requests'}
                            :{' '}
                            <strong>
                              {formatIntCounter(
                                Number(rawCacheStats.singleflight_coalesced),
                                lang,
                              )}
                            </strong>
                          </span>
                        )}
                        {rawCacheStats.negative_cache_entries != null && (
                          <span data-testid="b1-negative-entries">
                            {lang === 'vi'
                              ? 'Đệm kết quả trống'
                              : 'Empty-Result Cache'}
                            :{' '}
                            <strong>
                              {formatIntCounter(
                                Number(rawCacheStats.negative_cache_entries),
                                lang,
                              )}
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
                          {formatStatCellValue(value, lang)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {appSqliteWal && (
                    <div
                      data-testid="sqlite-wal-telemetry"
                      className="flex flex-wrap items-center gap-2 text-[11px] pt-1"
                    >
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                        <HardDrive className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        {lang === 'vi'
                          ? 'Thông số kỹ thuật CSDL'
                          : 'Database Settings'}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          {lang === 'vi' ? 'Chế độ ghi nhật ký:' : 'Journal Mode:'}
                        </span>
                        <span className="font-mono font-bold">
                          {String(appSqliteWal.journal_mode ?? 'WAL').toUpperCase()}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          {lang === 'vi'
                            ? 'Mức đồng bộ dữ liệu:'
                            : 'Data Sync Level:'}
                        </span>
                        <span className="font-mono font-bold">
                          {formatSqliteSyncMode(appSqliteWal.synchronous, lang)}
                        </span>
                      </span>
                      {(appSqliteWal.busy_timeout_ms != null ||
                        appSqliteWal.busy_timeout != null) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                          <span className="text-slate-500 dark:text-slate-400">
                            {lang === 'vi'
                              ? 'Thời gian chờ khóa (ms):'
                              : 'Lock Timeout (ms):'}
                          </span>
                          <span className="font-mono font-bold tabular-nums">
                            {`${String(appSqliteWal.busy_timeout_ms ?? appSqliteWal.busy_timeout)} ms`}
                          </span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200 font-semibold">
                        {formatLocalPapersDbMode(localPapersSqliteWal, lang)}
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
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              {lang === 'vi'
                ? 'Thông số kỹ thuật nâng cao (Dành cho quản trị hạ tầng)'
                : 'Advanced Diagnostics (Infrastructure Details)'}
            </span>
            <SymmetricChevron
              open={diagnosticsOpen}
              size={15}
              className="text-slate-400"
            />
          </button>

          <div
            data-testid="advanced-diagnostics-panel"
            data-open={diagnosticsOpen ? 'true' : 'false'}
          >
            <AccordionExpand open={diagnosticsOpen}>
              <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div
                  data-testid="sqlite-wal-telemetry"
                  className="flex flex-wrap items-center gap-2 text-[11px] pt-2"
                >
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                    <HardDrive className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    {lang === 'vi'
                      ? 'Thông số kỹ thuật CSDL'
                      : 'Database Settings'}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200">
                    <span className="text-slate-500 dark:text-slate-400">
                      {lang === 'vi' ? 'Chế độ ghi nhật ký:' : 'Journal Mode:'}
                    </span>
                    <span className="font-mono font-bold">
                      {String(appSqliteWal.journal_mode ?? 'WAL').toUpperCase()}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                    <span className="text-slate-500 dark:text-slate-400">
                      {lang === 'vi'
                        ? 'Mức đồng bộ dữ liệu:'
                        : 'Data Sync Level:'}
                    </span>
                    <span className="font-mono font-bold">
                      {formatSqliteSyncMode(appSqliteWal.synchronous, lang)}
                    </span>
                  </span>
                  {(appSqliteWal.busy_timeout_ms != null ||
                    appSqliteWal.busy_timeout != null) && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                      <span className="text-slate-500 dark:text-slate-400">
                        {lang === 'vi'
                          ? 'Thời gian chờ khóa (ms):'
                          : 'Lock Timeout (ms):'}
                      </span>
                      <span className="font-mono font-bold tabular-nums">
                        {`${String(appSqliteWal.busy_timeout_ms ?? appSqliteWal.busy_timeout)} ms`}
                      </span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200 font-semibold">
                    {formatLocalPapersDbMode(localPapersSqliteWal, lang)}
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
          lang === 'vi'
            ? 'Xóa bộ nhớ đệm tra cứu tạm?'
            : 'Clear temporary lookup cache?'
        }
        message={
          lang === 'vi'
            ? 'Chỉ xóa kết quả tra cứu tạm từ nguồn ngoài; tài khoản, bài nộp, báo cáo kiểm chứng và thư viện học thuật tích hợp sẵn hoàn toàn không bị ảnh hưởng. Lần kiểm tra tiếp theo có thể mất thêm vài giây.'
            : 'Only temporary external lookup results will be cleared. User accounts, submitted documents, reports, and the built-in scholarly library remain untouched. The next few checks may take slightly longer.'
        }
        confirmLabel={lang === 'vi' ? 'Xóa bộ nhớ đệm' : 'Clear cache'}
        cancelLabel={lang === 'vi' ? 'Hủy' : 'Cancel'}
        onConfirm={handleClearCache}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
