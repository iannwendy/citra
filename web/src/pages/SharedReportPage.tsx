import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Globe,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  ExternalLink,
  Lock,
  Sparkles,
} from 'lucide-react';
import { api, type SharedEssayReport, type SharedVerdictItem } from '@/api/client';
import { FileFormatIcon } from '@/components/FileFormatIcon';

/**
 * Deterministic 15x15 QR-style verification matrix SVG from a string seed (share URL + receipt ID).
 * Renders standard QR finder patterns at the 3 corners and deterministic data modules in the grid.
 */
function VerificationQrMatrixSvg({
  value,
  size = 112,
}: {
  value: string;
  size?: number;
}) {
  const grid = useMemo(() => {
    const dim = 15;
    const matrix: boolean[][] = Array.from({ length: dim }, () =>
      Array(dim).fill(false),
    );

    const drawFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const isBorder = r === 0 || r === 4 || c === 0 || c === 4;
          const isCenter = r === 2 && c === 2;
          matrix[r0 + r][c0 + c] = isBorder || isCenter;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, dim - 5);
    drawFinder(dim - 5, 0);

    // Deterministic FNV-1a hash stream over value
    let hash = 2166136261;
    const seed = value || 'CITRA-VERIFY';
    for (let r = 0; r < dim; r++) {
      for (let c = 0; c < dim; c++) {
        const inTopLeft = r < 6 && c < 6;
        const inTopRight = r < 6 && c >= dim - 6;
        const inBottomLeft = r >= dim - 6 && c < 6;
        if (inTopLeft || inTopRight || inBottomLeft) continue;
        const ch = seed.charCodeAt((r * dim + c) % seed.length);
        hash ^= ch + r * 31 + c * 17;
        hash = Math.imul(hash, 16777619);
        matrix[r][c] = (Math.abs(hash) & 1) === 1;
      }
    }
    return matrix;
  }, [value]);

  const dim = grid.length;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label="CITRA Verification QR Matrix"
      data-testid="qr-verification-matrix"
      className="rounded-lg bg-white p-2 border border-slate-200 dark:border-slate-700 shadow-xs shrink-0"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      {grid.map((row, rIdx) =>
        row.map((cell, cIdx) =>
          cell ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx}
              y={rIdx}
              width={0.92}
              height={0.92}
              rx={0.14}
              fill="#0f172a"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

const CIS_COMPONENT_KEYS: Array<{
  key: string;
  labelKey: string;
  fallbackEn: string;
}> = [
  {
    key: 'verified_ratio',
    labelKey: 'sharedReport.compVerifiedRatio',
    fallbackEn: 'Verified Ratio (Layer 2)',
  },
  {
    key: 'metadata_accuracy',
    labelKey: 'sharedReport.compMetadataAccuracy',
    fallbackEn: 'Metadata Accuracy',
  },
  {
    key: 'in_text_bib_consistency',
    labelKey: 'sharedReport.compLinkingConsistency',
    fallbackEn: 'In-Text ↔ Bibliography Consistency (Layer 1)',
  },
  {
    key: 'format_consistency',
    labelKey: 'sharedReport.compFormatConsistency',
    fallbackEn: 'Citation Style Consistency',
  },
  {
    key: 'identifier_validity',
    labelKey: 'sharedReport.compIdentifierValidity',
    fallbackEn: 'DOI / Identifier Validity',
  },
];

export function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<SharedEssayReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError('Missing verification token');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.getSharedEssayReport(token);
        if (!cancelled) {
          setReport(res);
          // Expand first item by default so visitors see rich neuro-symbolic trace
          if (res.verdicts?.length > 0) {
            setExpandedIds({ [res.verdicts[0].reference_id]: true });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t('sharedReport.invalidOrExpiredDesc'),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  const shareUrlFull = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://citra.io.vn';
    return `${origin}/verify/share/${token ?? ''}`;
  }, [token]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard?.writeText(shareUrlFull);
    } catch {
      // Clipboard fallback ignored in headless environments
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleExpand = (refId: string) => {
    setExpandedIds((prev) => ({ ...prev, [refId]: !prev[refId] }));
  };

  const toggleLanguage = () => {
    void i18n.changeLanguage(lang === 'vi' ? 'en' : 'vi');
  };

  const renderVerdictBadge = (label: SharedVerdictItem['label']) => {
    switch (label) {
      case 'verified':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('verdict.verified')}
          </span>
        );
      case 'metadata_error':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('verdict.metadataError')}
          </span>
        );
      case 'suspected_hallucination':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300 border border-red-300/60 dark:border-red-800">
            <XCircle className="h-3.5 w-3.5" />
            {t('verdict.suspectedHallucination')}
          </span>
        );
      case 'resource':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800">
            <Globe className="h-3.5 w-3.5" />
            {t('verdict.resource')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300/60 dark:border-slate-700">
            <HelpCircle className="h-3.5 w-3.5" />
            {t('verdict.unresolved')}
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6"
        data-testid="shared-report-loading"
      >
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
        <p className="text-sm font-mono text-slate-600 dark:text-slate-400">
          {t('sharedReport.verifyingSignature')}
        </p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div
        className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6"
        data-testid="shared-report-error"
      >
        <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 p-6 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/80 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
            {t('sharedReport.invalidOrExpiredTitle')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
            {error || t('sharedReport.invalidOrExpiredDesc')}
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            {t('sharedReport.returnHome')}
          </Link>
        </div>
      </div>
    );
  }

  const cisScore = Number(report.cis?.score ?? 0);
  const cisComponents = report.cis?.components ?? {};
  const counts = report.verdict_counts ?? {
    verified: 0,
    metadata_error: 0,
    suspected_hallucination: 0,
    unresolved: 0,
    resource: 0,
  };

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-16"
      data-testid="shared-report-page"
    >
      {/* Top Public Verification Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white"
            >
              <ShieldCheck className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <span>CITRA</span>
            </Link>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Lock className="h-3 w-3" />
              {t('sharedReport.publicAuditBadge')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLanguage}
              data-testid="shared-lang-toggle"
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {lang === 'vi' ? 'EN' : 'VI'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              data-testid="copy-share-url-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {t('sharedReport.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {t('sharedReport.copyVerificationLink')}
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 space-y-6">
        {/* Digital Verification Receipt Card */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
          <div className="flex flex-col lg:flex-row items-start justify-between gap-6">
            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span
                  data-testid="receipt-id-badge"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-xs font-bold bg-indigo-50 dark:bg-indigo-950/90 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {report.receipt_id}
                </span>
                <span
                  data-testid="hmac-verified-seal"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t('sharedReport.hmacVerifiedSeal')}
                </span>
              </div>

              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                  {t('sharedReport.receiptHeading')}
                </p>
                <div className="flex items-center gap-3 min-w-0">
                  <FileFormatIcon filename={report.filename} size="lg" />
                  <h1
                    className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white break-words"
                    data-testid="shared-report-filename"
                  >
                    {report.filename}
                  </h1>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs font-mono">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-slate-400 dark:text-slate-500">
                    {t('sharedReport.pagesLabel')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {report.num_pages}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-slate-400 dark:text-slate-500">
                    {t('sharedReport.citationsLabel')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {report.num_citations}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-slate-400 dark:text-slate-500">
                    {t('sharedReport.styleLabel')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {report.style_profile?.style || 'APA'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-slate-400 dark:text-slate-500">
                    {t('sharedReport.verifiedAtLabel')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5 truncate">
                    {report.verified_at ? report.verified_at.slice(0, 10) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* QR Matrix + Cryptographic Signature Block */}
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 w-full lg:w-auto">
              <VerificationQrMatrixSvg
                value={`${report.receipt_id}|${shareUrlFull}`}
                size={96}
              />
              <div className="space-y-1 text-xs font-mono min-w-0">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {t('sharedReport.qrSealTitle')}
                </div>
                <div className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                  {t('sharedReport.qrSealSubtitle')}
                </div>
                {report.signature_prefix && (
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate">
                    SIG: {report.signature_prefix}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CIS Score & 5-Component Breakdown + Verdict Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('essay.cisTitle')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('essay.cisSubtitle')}
                </p>
              </div>
              <div
                data-testid="shared-cis-score"
                className="text-3xl font-display font-extrabold text-indigo-600 dark:text-indigo-400"
              >
                {cisScore.toFixed(1)}
                <span className="text-sm font-mono text-slate-400">/100</span>
              </div>
            </div>

            <div className="space-y-3">
              {CIS_COMPONENT_KEYS.map(({ key, labelKey, fallbackEn }) => {
                const rawVal = Number(cisComponents[key] ?? 0);
                const pct = Math.max(0, Math.min(100, rawVal <= 1 ? rawVal * 100 : rawVal));
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-700 dark:text-slate-300">
                        {t(labelKey, fallbackEn)}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                {t('sharedReport.verdictDistributionTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                {t('sharedReport.verdictDistributionSubtitle')}
              </p>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-900/60">
                  <div className="text-emerald-700 dark:text-emerald-300">
                    {t('verdict.verified')}
                  </div>
                  <div
                    className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 mt-1"
                    data-testid="count-verified"
                  >
                    {counts.verified}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-900/60">
                  <div className="text-amber-700 dark:text-amber-300">
                    {t('verdict.metadataError')}
                  </div>
                  <div
                    className="text-2xl font-bold text-amber-800 dark:text-amber-200 mt-1"
                    data-testid="count-metadata-error"
                  >
                    {counts.metadata_error}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-red-50/70 dark:bg-red-950/40 border border-red-200/70 dark:border-red-900/60">
                  <div className="text-red-700 dark:text-red-300">
                    {t('verdict.suspectedHallucination')}
                  </div>
                  <div
                    className="text-2xl font-bold text-red-800 dark:text-red-200 mt-1"
                    data-testid="count-suspected"
                  >
                    {counts.suspected_hallucination}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-600 dark:text-slate-400">
                    {t('verdict.unresolved')} / {t('verdict.resource')}
                  </div>
                  <div
                    className="text-2xl font-bold text-slate-800 dark:text-slate-200 mt-1"
                    data-testid="count-other"
                  >
                    {counts.unresolved + counts.resource}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              {report.disclaimer}
            </div>
          </section>
        </div>

        {/* Expandable Reference Verdicts List */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t('essay.citationVerificationResults')} ({report.verdicts.length})
              </h2>
            </div>
          </div>

          {report.verdicts.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
              {t('sharedReport.noVerdicts')}
            </p>
          ) : (
            <div className="space-y-3">
              {report.verdicts.map((v, idx) => {
                const isExpanded = Boolean(expandedIds[v.reference_id]);
                const matched = v.matched_source;
                return (
                  <div
                    key={v.reference_id || idx}
                    data-testid={`shared-verdict-row-${idx}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(v.reference_id)}
                      className="w-full text-left p-4 flex items-start justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-400">
                            #{idx + 1} ({v.reference_id})
                          </span>
                          {renderVerdictBadge(v.label)}
                          <span className="font-mono text-xs text-slate-500">
                            {(Number(v.confidence || 0) * 100).toFixed(0)}%{' '}
                            {t('essay.confidence')}
                          </span>
                        </div>
                        <p className="text-sm text-slate-900 dark:text-slate-100 font-medium break-words">
                          {v.raw_text}
                        </p>
                      </div>
                      <span className="text-slate-400 mt-1 shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 space-y-2.5 text-xs">
                        {v.explanation && (
                          <div>
                            <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                              {t('sharedReport.explanationLabel')}:{' '}
                            </span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {v.explanation}
                            </span>
                          </div>
                        )}
                        {v.triggered_rules && v.triggered_rules.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                              {t('essay.rulesTriggered')}:
                            </span>
                            {v.triggered_rules.map((r) => (
                              <span
                                key={r}
                                className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-mono text-[11px]"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                        {matched && (
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 space-y-1">
                            <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                              <span>
                                {t('sharedReport.matchedSourceLabel')}:{' '}
                                {(matched.source || 'scholarly_db').toUpperCase()}
                              </span>
                              {matched.url && (
                                <a
                                  href={matched.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  DOI / Source <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            {matched.title && (
                              <div className="text-slate-800 dark:text-slate-200 font-medium">
                                {matched.title}
                              </div>
                            )}
                            <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                              {[
                                matched.authors?.join(', '),
                                matched.year,
                                matched.venue,
                                matched.doi ? `DOI: ${matched.doi}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
