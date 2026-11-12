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
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { Button } from '@/components/ui/button';
import { api, type SystemHealth } from '@/api/client';
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
};

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
  const cacheEntries = Object.entries(data.cache_stats ?? {}).filter(
    ([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );

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
