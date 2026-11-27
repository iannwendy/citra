import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18nInstance from '@/i18n';
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
  Scale,
  Printer,
  Sun,
  Moon,
  Search,
} from 'lucide-react';
import {
  api,
  type SharedEssayReport,
  type SharedVerdictItem,
  type Verdict,
} from '@/api/client';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { useToast } from '@/contexts/ToastContext';
import { useTheme } from '@/contexts/ThemeContext';
import { copyTextToClipboard } from '@/lib/clipboard';
import { toSafeDoiHref, toSafeExternalHref } from '@/lib/utils';
import { encodeQrMatrix } from '@/lib/qrCode';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getRuleDisplayName,
  getSourceDisplayName,
  getVerdictExplanation,
  isLegalStatuteVerdict,
} from '@/lib/verdictExplanation';
import {
  normalizeVerdictKey,
  getVerdictDisplay,
  formatCisScore,
  formatLocalizedDateTime,
  formatUserError,
  getScannedPdfNotice,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';

/**
 * Genuine ISO/IEC 18004 QR Code SVG with a 4-module quiet zone.
 * Encodes the pure verification URL so iOS/Android phone cameras immediately
 * recognize and open the verification link.
 */
function VerificationQrMatrixSvg({
  value,
  matrix,
  size = 112,
}: {
  value: string;
  matrix?: number[][];
  size?: number;
}) {
  const grid = useMemo(() => {
    if (
      Array.isArray(matrix) &&
      matrix.length >= 21 &&
      Array.isArray(matrix[0]) &&
      matrix[0].length === matrix.length
    ) {
      return matrix;
    }
    return encodeQrMatrix(value || 'https://citra.io.vn');
  }, [value, matrix]);

  const dim = grid.length;
  const quiet = 4;
  const totalDim = dim + quiet * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${totalDim} ${totalDim}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="CITRA Verification QR Matrix"
      data-testid="qr-verification-matrix"
      className="rounded-lg bg-white border border-slate-200 dark:border-slate-700 shadow-sm shrink-0 select-none"
    >
      <rect width={totalDim} height={totalDim} fill="#ffffff" />
      {grid.map((row, rIdx) =>
        row.map((cell, cIdx) =>
          cell ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx + quiet}
              y={rIdx + quiet}
              width={1}
              height={1}
              fill="#0f172a"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/**
 * Strips raw markdown backticks, internal neural telemetry blocks, and raw
 * uppercase backend enum tokens from public verification text.
 */
function sanitizePublicText(text: string, lang: 'en' | 'vi'): string {
  if (!text) return '';
  let out = text
    // Strip internal [Neural: content alignment score=...] blocks
    .replace(/\s*\[Neural:[^\]]*\]/gi, '')
    // Strip parenthetical raw telemetry e.g. (title_sim=1.00, author_sim=1.00)
    .replace(/\s*\((?:[^()]*\b(?:title_sim|author_sim|year_diff|score|sim)=[^()]*)\)/gi, '')
    // Unwrap backticked enum tokens and replace known ones with human labels
    .replace(/`([^`]+)`/g, (_match, inner: string) => {
      const token = inner.trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (
        token === 'suspected_hallucination' ||
        token === 'metadata_error' ||
        token === 'verified' ||
        token === 'unresolved' ||
        token === 'resource' ||
        token === 'url_resource'
      ) {
        return `"${getVerdictDisplay(token, lang).label}"`;
      }
      return inner.trim();
    })
    // Replace bare uppercase internal enum tokens
    .replace(/\bSUSPECTED_HALLUCINATION\b/g, getVerdictDisplay('suspected_hallucination', lang).label)
    .replace(/\bMETADATA_ERROR\b/g, getVerdictDisplay('metadata_error', lang).label)
    .replace(/\bURL_RESOURCE\b/g, getVerdictDisplay('resource', lang).label)
    .replace(/\bUNCITED_REF\b/g, lang === 'vi' ? 'Chưa trích dẫn trong bài' : 'Not Cited')
    .replace(/\bSTYLE_INCONSISTENT\b/g, lang === 'vi' ? 'Khác chuẩn trích dẫn' : 'Style Issue')
    .replace(/\bDUPLICATE_REF\b/g, lang === 'vi' ? 'Trích dẫn trùng lặp' : 'Duplicate Reference')
    // Clean double closing parens and double spaces
    .replace(/\)\)+/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Fix missing space after colon in Vietnamese/English prose (excluding URLs/times)
  out = out.replace(/([A-Za-zÀ-ỹ]):(?=[A-Za-zÀ-ỹ])/g, '$1: ');
  return out;
}

function localizeExplanation(v: SharedVerdictItem, lang: 'en' | 'vi'): string {
  const raw = (v.explanation || v.reasoning || '').trim();
  const asVerdict: Verdict = {
    citation_id: v.citation_id || v.reference_id || 'v0',
    citation_raw: v.raw_text || v.citation_raw || '',
    label: v.label,
    confidence: Number(v.confidence || 0),
    reasoning: raw,
    triggered_rules: v.triggered_rules || [],
    mismatched_fields: v.mismatched_fields || [],
    matched_sources:
      v.matched_sources && v.matched_sources.length > 0
        ? v.matched_sources
        : v.matched_source
          ? [v.matched_source]
          : [],
    url_status: v.url_status,
    url_status_code: v.url_status_code,
    archive_url: v.archive_url,
    cited_url: v.cited_url,
    is_retracted: v.is_retracted,
    html_meta: v.html_meta,
    features: v.features,
    numeric_index: v.numeric_index,
    sub_index: v.sub_index,
    composite_label: v.composite_label,
    is_overridden: false,
    mapping_status:
      (v.mapping_status as Verdict['mapping_status']) || 'matched',
    mapping_confidence: 1.0,
  };
  if (lang === 'en') {
    const hasVietnameseChars =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
        raw,
      );
    const hasRawTelemetry = /\[Neural:|title_sim=|author_sim=|\bR-[A-Z0-9_-]+\b/i.test(raw);
    if (
      !raw ||
      hasVietnameseChars ||
      hasRawTelemetry ||
      v.label === 'resource' ||
      (v.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH') ||
      (v.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')
    ) {
      return sanitizePublicText(getVerdictExplanation(asVerdict, 'en'), 'en');
    }
    return sanitizePublicText(raw, 'en');
  }
  return sanitizePublicText(getVerdictExplanation(asVerdict, 'vi'), 'vi');
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

interface PublicReceiptHeaderProps {
  lang: 'en' | 'vi';
  isDark: boolean;
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  showReportActions?: boolean;
  copied?: boolean;
  onCopyLink?: () => void;
  onPrint?: () => void;
}

function PublicReceiptHeader({
  lang,
  isDark,
  onToggleTheme,
  onToggleLanguage,
  showReportActions = false,
  copied = false,
  onCopyLink,
  onPrint,
}: PublicReceiptHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md sticky top-0 z-40 print:static print:bg-white print:border-slate-300">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white shrink-0"
          >
            <ShieldCheck className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <span>CITRA</span>
          </Link>
          <span
            data-testid="shared-receipt-badge"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap"
          >
            <Lock className="h-3 w-3 shrink-0" />
            {lang === 'vi'
              ? 'CHỨNG NHẬN XÁC MINH TRÍCH DẪN'
              : 'CITATION VERIFICATION RECEIPT'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 print:hidden">
          <button
            type="button"
            onClick={onToggleTheme}
            data-testid="shared-theme-toggle"
            aria-label={
              lang === 'vi'
                ? isDark
                  ? 'Chuyển sang giao diện sáng'
                  : 'Chuyển sang giao diện tối'
                : isDark
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
            }
            title={
              lang === 'vi'
                ? isDark
                  ? 'Chuyển sang giao diện sáng'
                  : 'Chuyển sang giao diện tối'
                : isDark
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
            }
            className="inline-flex items-center justify-center p-1.5 sm:px-2 sm:py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer touch-manipulation select-none"
          >
            {isDark ? (
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-indigo-600" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleLanguage}
            data-testid="shared-lang-toggle"
            aria-label={t('nav.language')}
            title={
              lang === 'vi'
                ? 'Chuyển sang Tiếng Anh (EN)'
                : 'Switch to Vietnamese (VI)'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer touch-manipulation select-none"
          >
            <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>

          {showReportActions && onPrint && (
            <button
              type="button"
              onClick={onPrint}
              data-testid="shared-print-btn"
              title={lang === 'vi' ? 'In hoặc lưu PDF chứng nhận' : 'Print or save receipt as PDF'}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors cursor-pointer touch-manipulation select-none"
            >
              <Printer className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
              <span className="hidden md:inline">
                {lang === 'vi' ? 'In / Lưu PDF' : 'Print / Save PDF'}
              </span>
            </button>
          )}

          {showReportActions && onCopyLink && (
            <button
              type="button"
              onClick={onCopyLink}
              data-testid="copy-share-url-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white transition-colors cursor-pointer touch-manipulation select-none"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>{t('sharedReport.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>{t('sharedReport.copyVerificationLink')}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { isDark, setTheme } = useTheme();
  const [report, setReport] = useState<SharedEssayReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);

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
              : i18nInstance.t('sharedReport.invalidOrExpiredDesc'),
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
  }, [token]);

  const shareUrlFull = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://citra.io.vn';
    return `${origin}/verify/share/${token ?? ''}`;
  }, [token]);

  const handleCopyLink = async () => {
    await copyTextToClipboard(shareUrlFull);
    setCopied(true);
    toast.success(t('sharedReport.copied'), shareUrlFull);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const handleToggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  const toggleExpand = (refId: string) => {
    setExpandedIds((prev) => ({ ...prev, [refId]: !prev[refId] }));
  };

  const toggleLanguage = () => {
    const next = lang === 'vi' ? 'en' : 'vi';
    void i18n.changeLanguage(next);
    try {
      localStorage.setItem('language', next);
      localStorage.setItem('i18nextLng', next);
    } catch {
      // Ignore storage errors in restricted environments
    }
    const fixedT = i18n.getFixedT(next);
    toast.success(
      fixedT('settings.languageUpdated'),
      next === 'vi' ? 'Tiếng Việt (VI)' : 'English (EN)',
    );
  };

  const renderVerdictBadge = (
    label: SharedVerdictItem['label'],
    triggeredRules?: string[],
  ) => {
    const normalized = normalizeVerdictKey(label);
    const display = getVerdictDisplay(normalized, lang);
    switch (normalized) {
      case 'verified':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {display.label}
          </span>
        );
      case 'metadata_error': {
        const isIncompleteMeta = (triggeredRules ?? []).includes(
          'R-INCOMPLETE-METADATA',
        );
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {isIncompleteMeta
              ? lang === 'vi'
                ? 'Thiếu quy cách trích dẫn'
                : 'Incomplete Reference'
              : display.label}
          </span>
        );
      }
      case 'suspected_hallucination':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300 border border-red-300/60 dark:border-red-800">
            <XCircle className="h-3.5 w-3.5" />
            {display.label}
          </span>
        );
      case 'resource': {
        const isLegal = isLegalStatuteVerdict({
          label,
          triggered_rules: triggeredRules,
        });
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800">
            {isLegal ? (
              <Scale className="h-3.5 w-3.5" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            {isLegal
              ? lang === 'vi'
                ? 'Văn bản Pháp luật'
                : 'Legal Statute'
              : display.label}
          </span>
        );
      }
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300/60 dark:border-slate-700">
            <HelpCircle className="h-3.5 w-3.5" />
            {display.label}
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col"
        data-testid="shared-report-loading"
      >
        <PublicReceiptHeader
          lang={lang}
          isDark={isDark}
          onToggleTheme={handleToggleTheme}
          onToggleLanguage={toggleLanguage}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
          <p className="text-sm font-mono text-slate-600 dark:text-slate-400">
            {t('sharedReport.verifyingSignature')}
          </p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    const formattedErr = formatUserError(
      error,
      lang,
      t('sharedReport.invalidOrExpiredDesc'),
    );
    const displayErr =
      lang === 'vi' &&
      /tampered|missing verification token|signature/i.test(formattedErr)
        ? t('sharedReport.invalidOrExpiredDesc')
        : formattedErr;

    return (
      <div
        className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col"
        data-testid="shared-report-error"
      >
        <PublicReceiptHeader
          lang={lang}
          isDark={isDark}
          onToggleTheme={handleToggleTheme}
          onToggleLanguage={toggleLanguage}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 p-6 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/80 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
              {t('sharedReport.invalidOrExpiredTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              {displayErr}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3.5 py-2.5 mb-6 leading-relaxed">
              {lang === 'vi'
                ? 'Vui lòng liên hệ tác giả tài liệu để xin liên kết xác minh mới.'
                : 'Please contact the document author to request a new verification link.'}
            </p>
            <Link
              to="/"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
            >
              {t('sharedReport.returnHome')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const docDiag = (
    report as SharedEssayReport & {
      document_diagnostics?: {
        is_scanned_pdf?: boolean;
        scanned_pages_count?: number;
        avg_chars_per_page?: number;
        legacy_encoding_detected?: string | null;
        ocr_pages_recovered?: number[];
        warning_message?: string | null;
        warning_message_en?: string | null;
        warning_message_vi?: string | null;
      } | null;
    }
  ).document_diagnostics;

  const isUnscannable =
    Boolean(report.cis?.is_unscannable) ||
    (Boolean(docDiag?.is_scanned_pdf) &&
      report.num_citations === 0 &&
      report.verdicts.length === 0);

  const cisScore = Number(report.cis?.score ?? 0);
  const cisComponents = report.cis?.components ?? {};
  const counts = report.verdict_counts ?? {
    verified: 0,
    metadata_error: 0,
    suspected_hallucination: 0,
    unresolved: 0,
    resource: 0,
  };
  const qrMatrixForUrl =
    report.qr_matrix && report.verification_url === shareUrlFull
      ? report.qr_matrix
      : undefined;
  const rawStyle = (report.style_profile?.style || 'APA').toUpperCase();
  const displayStyle =
    rawStyle === 'APA_LIKE' || rawStyle === 'APA-LIKE'
      ? 'APA'
      : rawStyle === 'IEEE_LIKE' || rawStyle === 'IEEE-LIKE'
        ? 'IEEE'
        : rawStyle === 'MIXED'
          ? lang === 'vi'
            ? 'Hỗn hợp'
            : 'Mixed'
          : rawStyle === 'UNKNOWN'
            ? report.filename?.toLowerCase().endsWith('.bib')
              ? 'BibTeX'
              : report.filename?.toLowerCase().endsWith('.ris')
                ? 'RIS'
                : 'APA'
            : rawStyle;

  const formattedVerifiedAt = formatLocalizedDateTime(report.verified_at, lang);
  const sanitizedDisclaimer = sanitizePublicText(
    t('sharedReport.disclaimer'),
    lang,
  );

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-16 print:bg-white print:pb-6"
      data-testid="shared-report-page"
    >
      {/* Top Public Verification Bar */}
      <PublicReceiptHeader
        lang={lang}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        onToggleLanguage={toggleLanguage}
        showReportActions
        copied={copied}
        onCopyLink={() => void handleCopyLink()}
        onPrint={handlePrint}
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        <DecisionSupportBanner variant="compact" lang={lang} />

        {/* Digital Verification Receipt Card */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm print:shadow-none">
          <div className="flex flex-col lg:flex-row items-start justify-between gap-6">
            <div className="space-y-3 flex-1 min-w-0 w-full">
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
                  {lang === 'vi'
                    ? 'Chứng nhận Xác minh Trích dẫn CITRA'
                    : 'CITRA Citation Verification Receipt'}
                </p>
                <div className="flex items-center gap-3 min-w-0">
                  <FileFormatIcon filename={report.filename} size="lg" />
                  <h1
                    className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white break-words [overflow-wrap:anywhere] min-w-0 flex-1"
                    data-testid="shared-report-filename"
                  >
                    {report.filename}
                  </h1>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs font-mono">
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
                    {displayStyle}
                  </div>
                </div>
                <div className="col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-slate-400 dark:text-slate-500">
                    {t('sharedReport.verifiedAtLabel')}
                  </div>
                  <div
                    data-testid="shared-verified-at"
                    className="font-bold text-slate-800 dark:text-slate-200 mt-0.5 whitespace-nowrap"
                  >
                    {formattedVerifiedAt}
                  </div>
                </div>
              </div>
            </div>

            {/* QR Matrix + Integrity Seal Block */}
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 w-full lg:w-auto">
              <VerificationQrMatrixSvg
                value={shareUrlFull}
                matrix={qrMatrixForUrl}
                size={112}
              />
              <div className="space-y-1.5 text-xs font-mono min-w-0 flex-1">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {lang === 'vi' ? 'Mã xác thực toàn vẹn' : 'Tamper-Evident Seal'}
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

        {/* Document Ingestion Diagnostics (OCR, Legacy TCVN3/VNI, Scanned PDF) */}
        {(() => {
          if (!docDiag) return null;
          const hasLegacy = Boolean(docDiag.legacy_encoding_detected);
          const hasOcr = (docDiag.ocr_pages_recovered?.length ?? 0) > 0;
          const hasScanned = Boolean(docDiag.is_scanned_pdf);
          if (!hasLegacy && !hasOcr && !hasScanned) return null;
          const scannedNotice = getScannedPdfNotice(
            lang,
            docDiag.scanned_pages_count ?? report.num_pages,
            report.num_pages,
          );
          const scannedMessage =
            lang === 'en'
              ? docDiag.warning_message_en ||
                `${scannedNotice.title}. ${scannedNotice.description}`
              : docDiag.warning_message_vi ||
                `${scannedNotice.title}. ${scannedNotice.description}`;
          return (
            <div
              data-testid="shared-doc-diagnostics-banner"
              className="flex flex-wrap items-center gap-2.5"
            >
              {hasLegacy && (
                <div
                  data-testid="shared-legacy-encoding-pill"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200"
                >
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>
                    {lang === 'vi'
                      ? `Đã tự động chuyển mã bảng mã tiếng Việt cũ (${String(docDiag.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`
                      : `Auto-transcoded legacy Vietnamese encoding (${String(docDiag.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`}
                  </span>
                </div>
              )}
              {hasOcr && (
                <div
                  data-testid="shared-ocr-recovery-pill"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                >
                  <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    {lang === 'vi'
                      ? `Đã khôi phục văn bản bằng OCR tại trang: ${docDiag.ocr_pages_recovered!.join(', ')}`
                      : `Recovered text via OCR on page(s): ${docDiag.ocr_pages_recovered!.join(', ')}`}
                  </span>
                </div>
              )}
              {hasScanned && (
                <div
                  data-testid="shared-scanned-pdf-pill"
                  className="inline-flex items-start gap-2 px-3.5 py-2.5 rounded-xl text-xs bg-amber-50/90 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 leading-relaxed"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>{scannedMessage}</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* CIS Score & 5-Component Breakdown + Verdict Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm print:shadow-none">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('essay.cisTitle')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('essay.cisSubtitle')}
                </p>
              </div>
              {isUnscannable ? (
                <div
                  data-testid="shared-cis-score"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 whitespace-nowrap"
                >
                  {lang === 'vi' ? 'N/A · Không thể quét' : 'N/A · Not Scannable'}
                </div>
              ) : (
                <div
                  data-testid="shared-cis-score"
                  className="text-2xl sm:text-3xl font-display font-extrabold text-indigo-600 dark:text-indigo-400 whitespace-nowrap"
                >
                  {formatCisScore(cisScore)}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {CIS_COMPONENT_KEYS.map(({ key, labelKey, fallbackEn }) => {
                const rawVal = Number(cisComponents[key] ?? 0);
                const pct = isUnscannable
                  ? 0
                  : Math.max(0, Math.min(100, rawVal <= 1 ? rawVal * 100 : rawVal));
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-700 dark:text-slate-300">
                        {t(labelKey, fallbackEn)}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {isUnscannable ? '—' : `${pct.toFixed(0)}%`}
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

          <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm print:shadow-none flex flex-col justify-between">
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
                    {getVerdictDisplay('verified', lang).label}
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
                    {getVerdictDisplay('metadata_error', lang).label}
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
                    {getVerdictDisplay('suspected_hallucination', lang).label}
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
                    {getVerdictDisplay('unresolved', lang).label}
                  </div>
                  <div
                    className="text-2xl font-bold text-slate-800 dark:text-slate-200 mt-1"
                    data-testid="count-unresolved"
                  >
                    {counts.unresolved}
                  </div>
                </div>
                {counts.resource > 0 && (
                  <div className="col-span-2 p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/40 border border-violet-200/70 dark:border-violet-900/60 flex items-center justify-between">
                    <div className="text-violet-700 dark:text-violet-300">
                      {getVerdictDisplay('resource', lang).label}
                    </div>
                    <div
                      className="text-xl font-bold text-violet-800 dark:text-violet-200"
                      data-testid="count-resource"
                    >
                      {counts.resource}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              data-testid="shared-report-disclaimer"
              className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
            >
              {sanitizedDisclaimer}
            </div>
          </section>
        </div>

        {/* Expandable Reference Verdicts List */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm print:shadow-none">
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
                const normalizedLabel = normalizeVerdictKey(v.label);
                const matched =
                  v.matched_source ??
                  (v.matched_sources && v.matched_sources.length > 0
                    ? v.matched_sources[0]
                    : null);
                const observedWeb = extractObservedWebMeta(v);
                const rawUrlStatus = v.url_status ?? v.features?.url_status;
                const hasArchiveFallback =
                  Boolean(v.archive_url || v.features?.archive_url) ||
                  (v.triggered_rules ?? []).includes('R-WAYBACK-ARCHIVED');
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
                  v.url_status_code ?? v.features?.url_status_code;
                const isUrlContentMismatch = (v.triggered_rules ?? []).includes(
                  'R-URL-CONTENT-MISMATCH',
                );
                const markerLabel = getCitationMarkerLabel(v, idx);
                const localizedReason = localizeExplanation(v, lang);
                const matchedSourceDisplay = matched
                  ? matched.source?.toLowerCase() === 'vn_legal_registry' &&
                    lang === 'en'
                    ? 'VN Legal Registry'
                    : getSourceDisplayName(
                        matched.source || 'scholarly_db',
                        lang,
                        {
                          triggered_rules: v.triggered_rules,
                          external_ids: matched.external_ids,
                          venue: matched.venue,
                          title: matched.title,
                        },
                      )
                  : '';
                const showGoogleScholarFallback =
                  !matched &&
                  (normalizedLabel === 'suspected_hallucination' ||
                    normalizedLabel === 'unresolved');
                const scholarQuery = (v.raw_text || v.citation_raw || '')
                  .replace(/^\s*\[\d+[a-z]?\]\s*/i, '')
                  .trim()
                  .slice(0, 180);

                return (
                  <div
                    key={v.reference_id || idx}
                    data-testid={`shared-verdict-row-${idx}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(v.reference_id)}
                      className="w-full text-left p-4 flex items-start justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer touch-manipulation"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            title={v.reference_id}
                            className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400"
                          >
                            {markerLabel}
                          </span>
                          {renderVerdictBadge(v.label, v.triggered_rules)}
                          {urlStatus && (
                            <span
                              data-testid={`shared-url-status-${idx}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold border ${
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
                                          ? `✕ Liên kết hỏng (HTTP ${urlStatusCode ?? 404})`
                                          : `✕ Broken Link (HTTP ${urlStatusCode ?? 404})`
                                        : lang === 'vi'
                                          ? '✕ Tên miền không tồn tại'
                                          : '✕ Invalid Domain'}
                            </span>
                          )}
                          {(() => {
                            const extF = v.features as
                              | (NonNullable<SharedVerdictItem['features']> & {
                                  cross_lingual_detected?: boolean;
                                  cross_lingual_alignment?: boolean | number;
                                  cross_lingual_title_detected?: boolean;
                                  cross_lingual_title_sim?: number;
                                  title_sim_semantic?: number;
                                })
                              | undefined;
                            const isCrossLingual =
                              Boolean(extF?.cross_lingual_detected) ||
                              Boolean(extF?.cross_lingual_alignment) ||
                              Boolean(extF?.cross_lingual_title_detected) ||
                              (extF?.cross_lingual_title_sim ?? 0) >= 0.5 ||
                              (v.triggered_rules ?? []).some(
                                (r) =>
                                  r === 'R-CROSS-LINGUAL-ALIGNMENT' ||
                                  r === 'R-CROSS-LINGUAL-TITLE-MATCH',
                              );
                            if (!isCrossLingual) return null;
                            const crossSim = Math.max(
                              extF?.cross_lingual_title_sim ?? 0,
                              extF?.title_sim_semantic ?? 0,
                            );
                            return (
                              <span
                                data-testid={`shared-cross-lingual-badge-${idx}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800"
                              >
                                {lang === 'vi'
                                  ? 'Đối chiếu Việt ↔ Anh'
                                  : 'VI ↔ EN Cross-Lingual'}
                                {crossSim > 0 ? ` · ${Math.round(crossSim * 100)}%` : ''}
                              </span>
                            );
                          })()}
                          <span className="font-mono text-xs text-slate-500">
                            {(Number(v.confidence || 0) * 100).toFixed(0)}%{' '}
                            {t('essay.confidence')}
                          </span>
                        </div>
                        <p className="text-sm text-slate-900 dark:text-slate-100 font-medium break-words">
                          {v.raw_text}
                        </p>
                      </div>
                      <span className="text-slate-400 mt-1 shrink-0 print:hidden">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 space-y-2.5 text-xs">
                        {localizedReason && (
                          <div>
                            <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                              {t('sharedReport.explanationLabel')}:{' '}
                            </span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {localizedReason}
                            </span>
                          </div>
                        )}
                        {v.triggered_rules && v.triggered_rules.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                              {lang === 'vi' ? 'Tiêu chí kiểm tra' : 'Verification Checks'}:
                            </span>
                            {v.triggered_rules.map((r) => (
                              <span
                                key={r}
                                title={r}
                                className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium"
                              >
                                {getRuleDisplayName(r, lang)}
                              </span>
                            ))}
                          </div>
                        )}
                        {matched && (
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 space-y-1">
                            <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2 flex-wrap">
                              <span>
                                {t('sharedReport.matchedSourceLabel')}:{' '}
                                {matchedSourceDisplay}
                              </span>
                              {(() => {
                                const safeMatchedHref =
                                  toSafeExternalHref(matched.url) ??
                                  toSafeDoiHref(matched.doi);
                                if (!safeMatchedHref) return null;
                                return (
                                  <a
                                    href={safeMatchedHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                                  >
                                    {t('sharedReport.viewSourceLink')}{' '}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                );
                              })()}
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
                        {!matched && observedWeb && (
                          <div
                            data-testid={`shared-observed-web-meta-${idx}`}
                            className={`p-3 rounded-lg bg-white dark:bg-slate-800 border space-y-1 ${
                              isUrlContentMismatch
                                ? 'border-amber-200 dark:border-amber-800/80'
                                : 'border-slate-200/80 dark:border-slate-700'
                            }`}
                          >
                            <div
                              className={`font-mono font-semibold flex items-center justify-between gap-2 flex-wrap ${
                                isUrlContentMismatch
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : 'text-sky-700 dark:text-sky-300'
                              }`}
                            >
                              <span>
                                {getSourceDisplayName(
                                  observedWeb.isArchived
                                    ? 'wayback_html_meta'
                                    : 'web_html_meta',
                                  lang,
                                )}
                              </span>
                              {(() => {
                                const safeObservedHref =
                                  toSafeExternalHref(observedWeb.url) ??
                                  toSafeExternalHref(v.cited_url);
                                if (!safeObservedHref) return null;
                                return (
                                  <a
                                    href={safeObservedHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                                  >
                                    {t('sharedReport.viewSourceLink')}{' '}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                );
                              })()}
                            </div>
                            {observedWeb.title && (
                              <div className="text-slate-800 dark:text-slate-200 font-medium">
                                {observedWeb.title}
                              </div>
                            )}
                            <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                              {[
                                observedWeb.authors?.join(', '),
                                observedWeb.year,
                                observedWeb.venue,
                                observedWeb.doi
                                  ? `DOI: ${observedWeb.doi}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </div>
                        )}
                        {showGoogleScholarFallback && scholarQuery && (
                          <div className="pt-1">
                            <a
                              href={`https://scholar.google.com/scholar?q=${encodeURIComponent(scholarQuery)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`shared-google-scholar-${idx}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-medium transition-colors"
                            >
                              <Search className="h-3 w-3" />
                              {lang === 'vi'
                                ? 'Tìm thử trên Google Scholar'
                                : 'Search on Google Scholar'}
                              <ExternalLink className="h-3 w-3" />
                            </a>
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
