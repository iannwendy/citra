import { useTranslation } from 'react-i18next';
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  XCircle,
  HelpCircle,
  Link2,
  Scale,
} from 'lucide-react';
import {
  getVerdictDisplay,
  normalizeVerdictKey,
  resolveAcademicLang,
  type CanonicalVerdictKey,
} from '@/lib/academicTaxonomy';
import { isLegalStatuteVerdict } from '@/lib/verdictExplanation';

/* ============================================================
   CITRA — Verdict Badge Component
   Backed by Unified Academic Taxonomy (academicTaxonomy.ts)
   ============================================================ */

export type VerdictType =
  | 'VERIFIED'
  | 'LIKELY_VERIFIED'
  | 'METADATA_ERROR'
  | 'SOURCE_MISMATCH'
  | 'HALLUCINATED'
  | 'SUSPECTED_HALLUCINATION'
  | 'UNVERIFIABLE'
  | 'UNRESOLVED'
  | 'RESOURCE';

interface VerdictBadgeProps {
  verdict: VerdictType | string;
  triggeredRules?: string[];
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

interface VerdictVisualSpec {
  icon: React.ReactNode;
  bgClass: string;
  borderClass: string;
  iconColor: string;
  borderColorToken: string;
  underlineColorToken: string;
}

const CANONICAL_VISUALS: Record<CanonicalVerdictKey, VerdictVisualSpec> = {
  verified: {
    icon: <CheckCircle className="h-3.5 w-3.5 shrink-0" />,
    bgClass: 'bg-emerald-50 dark:bg-emerald-950',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    iconColor: 'text-emerald-700 dark:text-emerald-300',
    borderColorToken: 'border-emerald-400',
    underlineColorToken: 'decoration-emerald-500',
  },
  metadata_error: {
    icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
    bgClass: 'bg-amber-50 dark:bg-amber-950',
    borderClass: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-800 dark:text-amber-300',
    borderColorToken: 'border-amber-400',
    underlineColorToken: 'decoration-amber-500',
  },
  suspected_hallucination: {
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />,
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-700 dark:text-red-300',
    borderColorToken: 'border-red-400',
    underlineColorToken: 'decoration-red-500',
  },
  unresolved: {
    icon: <HelpCircle className="h-3.5 w-3.5 shrink-0" />,
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-700 dark:text-slate-300',
    borderColorToken: 'border-slate-400',
    underlineColorToken: 'decoration-slate-400',
  },
  resource: {
    icon: <Link2 className="h-3.5 w-3.5 shrink-0" />,
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-700 dark:text-violet-300',
    borderColorToken: 'border-violet-400',
    underlineColorToken: 'decoration-violet-500',
  },
};

const SOURCE_MISMATCH_VISUAL: VerdictVisualSpec = {
  icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />,
  bgClass: 'bg-orange-50 dark:bg-orange-950',
  borderClass: 'border-orange-200 dark:border-orange-800',
  iconColor: 'text-orange-700 dark:text-orange-300',
  borderColorToken: 'border-orange-400',
  underlineColorToken: 'decoration-orange-500',
};

function resolveVisualSpec(verdict: string): VerdictVisualSpec {
  const rawUpper = String(verdict ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (rawUpper === 'SOURCE_MISMATCH') {
    return SOURCE_MISMATCH_VISUAL;
  }
  const canonical = normalizeVerdictKey(verdict);
  return CANONICAL_VISUALS[canonical];
}

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-3 py-1 gap-1.5',
  lg: 'text-sm px-4 py-1.5 gap-2',
};

function resolveVerdictPresentation(
  verdict: string,
  triggeredRules: string[] | undefined,
  lang: 'en' | 'vi',
  t: ReturnType<typeof useTranslation>['t'],
) {
  const isVi = lang === 'vi';
  const canonicalKey = normalizeVerdictKey(verdict);
  const display = getVerdictDisplay(verdict, lang);
  const config = resolveVisualSpec(verdict);

  const isIncompleteMeta =
    canonicalKey === 'metadata_error' &&
    Boolean(triggeredRules?.includes('R-INCOMPLETE-METADATA'));
  const isLegalResource =
    canonicalKey === 'resource' &&
    isLegalStatuteVerdict({ label: verdict, triggered_rules: triggeredRules });

  const labelText = isLegalResource
    ? t('verdict.legalStatute', isVi ? 'Văn bản Pháp luật' : 'Legal Statute')
    : isIncompleteMeta
      ? t(
          'verdict.incompleteReference',
          isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference',
        )
      : display.label;

  const descriptionText = isLegalResource
    ? t(
        'verdict.legalStatuteDesc',
        isVi
          ? 'Văn bản Pháp luật — Văn bản quy phạm pháp luật đã nhận diện; không cần chỉnh sửa và không bị tính điểm trừ trích dẫn.'
          : 'Legal Statute — Recognized legal statute or government regulation; no action needed (excluded from academic citation penalty).',
      )
    : isIncompleteMeta
      ? t(
          'verdict.incompleteReferenceDesc',
          isVi
            ? 'Thiếu quy cách trích dẫn — Mục tham khảo thiếu tác giả, năm xuất bản hoặc nơi công bố (không phải nguồn bịa đặt); hãy bổ sung đầy đủ các thông tin còn thiếu.'
            : 'Incomplete Reference — Citation lacks required fields (author, publication year, or venue) rather than being fabricated; add the missing details to complete this entry.',
        )
      : `${display.label} — ${display.description}`;

  return { config, isLegalResource, labelText, descriptionText };
}

export function VerdictBadge({
  verdict,
  triggeredRules,
  size = 'md',
  showIcon = true,
  className = '',
}: VerdictBadgeProps) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const { config, isLegalResource, labelText, descriptionText } =
    resolveVerdictPresentation(verdict, triggeredRules, lang, t);

  return (
    <span
      className={`
        inline-flex items-center rounded-full font-semibold whitespace-nowrap shrink-0
        ${config.bgClass} ${config.borderClass} border
        ${sizeClasses[size]}
        ${className}
      `}
      title={descriptionText}
    >
      {showIcon && (
        <span className={config.iconColor}>
          {isLegalResource ? <Scale className="h-3.5 w-3.5 shrink-0" /> : config.icon}
        </span>
      )}
      <span className={config.iconColor}>{labelText}</span>
    </span>
  );
}

export function VerdictBadgeCompact({
  verdict,
  triggeredRules,
  className = '',
}: {
  verdict: VerdictType | string;
  triggeredRules?: string[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const { config, isLegalResource, descriptionText } = resolveVerdictPresentation(
    verdict,
    triggeredRules,
    lang,
    t,
  );

  return (
    <span
      className={`
        inline-flex items-center justify-center rounded-full shrink-0
        ${config.bgClass} ${config.borderClass} border
        w-6 h-6
        ${className}
      `}
      title={descriptionText}
    >
      <span className={config.iconColor}>
        {isLegalResource ? <Scale className="h-3.5 w-3.5 shrink-0" /> : config.icon}
      </span>
    </span>
  );
}

export function VerdictIcon({
  verdict,
  triggeredRules,
  size = 'md',
  className = '',
}: {
  verdict: VerdictType | string;
  triggeredRules?: string[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const { config, isLegalResource, descriptionText } = resolveVerdictPresentation(
    verdict,
    triggeredRules,
    lang,
    t,
  );

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <span className={`inline-flex shrink-0 ${className}`} title={descriptionText}>
      <span className={`${config.iconColor} ${iconSizes[size]}`}>
        {isLegalResource ? (
          <Scale className={`${iconSizes[size]} shrink-0`} />
        ) : (
          config.icon
        )}
      </span>
    </span>
  );
}

export function getVerdictColor(verdict: string): string {
  if (!String(verdict ?? '').trim()) return 'border-slate-300';
  return resolveVisualSpec(verdict).borderColorToken;
}

export function getVerdictUnderlineClass(verdict: string): string {
  if (!String(verdict ?? '').trim()) return 'decoration-slate-400';
  return resolveVisualSpec(verdict).underlineColorToken;
}
