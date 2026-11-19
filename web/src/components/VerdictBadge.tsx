import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, AlertCircle, XCircle, HelpCircle, Link2, Scale } from 'lucide-react';
import { getPlainVerdictLabel, isLegalStatuteVerdict } from '@/lib/verdictExplanation';

/* ============================================================
   SourceLogic — Verdict Badge Component
   Based on UX/UI Concept Verification Status Taxonomy
   ============================================================ */

// Verdict types based on UX/UI concept
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

// SourceLogic Design System color palette from UX/UI concept
const _VERIFIED_COLOR = 'hsl(160 84% 39%)';     // #10B981 - Green
const _LIKELY_VERIFIED_COLOR = 'hsl(142 71% 45%)'; // #22c55e - Light Green
const _METADATA_ERROR_COLOR = 'hsl(38 92% 50%)';  // #f59e0b - Amber
const _SOURCE_MISMATCH_COLOR = 'hsl(24 96% 54%)'; // #f97316 - Orange
const _HALLUCINATED_COLOR = 'hsl(0 72% 51%)';    // #ef4444 - Red
const _UNVERIFIABLE_COLOR = 'hsl(215 16% 47%)';    // #94a3b8 - Slate

// Verdict configuration based on UX/UI Concept Section 11: Verification Status Taxonomy
// Uses WCAG AA (>= 4.5:1) contrast pairs in Light & Dark modes
const verdictConfig: Record<string, {
  icon: React.ReactNode;
  label: string;
  bgClass: string;
  borderClass: string;
  iconColor: string;
}> = {
  VERIFIED: {
    icon: <CheckCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Verified',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    iconColor: 'text-emerald-700 dark:text-emerald-300',
  },
  LIKELY_VERIFIED: {
    icon: <CheckCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Likely Verified',
    bgClass: 'bg-green-50 dark:bg-green-950',
    borderClass: 'border-green-200 dark:border-green-800',
    iconColor: 'text-green-700 dark:text-green-300',
  },
  METADATA_ERROR: {
    icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Metadata Error',
    bgClass: 'bg-amber-50 dark:bg-amber-950',
    borderClass: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-800 dark:text-amber-300',
  },
  SOURCE_MISMATCH: {
    icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Source Mismatch',
    bgClass: 'bg-orange-50 dark:bg-orange-950',
    borderClass: 'border-orange-200 dark:border-orange-800',
    iconColor: 'text-orange-700 dark:text-orange-300',
  },
  HALLUCINATED: {
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Likely Hallucinated',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-700 dark:text-red-300',
  },
  SUSPECTED_HALLUCINATION: {
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Suspected',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-700 dark:text-red-300',
  },
  UNVERIFIABLE: {
    icon: <HelpCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Unverifiable',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-700 dark:text-slate-300',
  },
  UNRESOLVED: {
    icon: <HelpCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Unresolved',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-700 dark:text-slate-300',
  },
  RESOURCE: {
    icon: <Link2 className="h-3.5 w-3.5 shrink-0" />,
    label: 'URL Resource',
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-700 dark:text-violet-300',
  },
  LIKELY_HALLUCINATED: {
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Likely Hallucinated',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-700 dark:text-red-300',
  },
  SUSPECTED: {
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />,
    label: 'Suspected',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-700 dark:text-red-300',
  },
  URL_RESOURCE: {
    icon: <Link2 className="h-3.5 w-3.5 shrink-0" />,
    label: 'URL Resource',
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-700 dark:text-violet-300',
  },
  WEB_RESOURCE: {
    icon: <Link2 className="h-3.5 w-3.5 shrink-0" />,
    label: 'URL Resource',
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-700 dark:text-violet-300',
  },
};

function normalizeVerdictKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function resolveVerdictConfig(verdict: string) {
  const key = normalizeVerdictKey(verdict);
  return Object.prototype.hasOwnProperty.call(verdictConfig, key)
    ? verdictConfig[key]
    : verdictConfig.UNVERIFIABLE;
}

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-3 py-1 gap-1.5',
  lg: 'text-sm px-4 py-1.5 gap-2',
};

const verdictLabelKey: Record<string, string> = {
  VERIFIED: 'verdict.verified',
  LIKELY_VERIFIED: 'verdict.likelyVerified',
  METADATA_ERROR: 'verdict.metadataError',
  SOURCE_MISMATCH: 'verdict.sourceMismatch',
  HALLUCINATED: 'verdict.likelyHallucinated',
  LIKELY_HALLUCINATED: 'verdict.likelyHallucinated',
  SUSPECTED_HALLUCINATION: 'essay.suspected',
  SUSPECTED: 'essay.suspected',
  UNVERIFIABLE: 'essay.unverifiable',
  UNRESOLVED: 'verdict.unresolved',
  RESOURCE: 'essay.urlResource',
  URL_RESOURCE: 'essay.urlResource',
  WEB_RESOURCE: 'essay.urlResource',
};

function resolveVerdictPresentation(
  verdict: string,
  triggeredRules: string[] | undefined,
  lang: 'en' | 'vi',
  t: ReturnType<typeof useTranslation>['t'],
) {
  const isVi = lang === 'vi';
  const normalizedKey = normalizeVerdictKey(verdict);
  const isIncompleteMeta =
    normalizedKey === 'METADATA_ERROR' &&
    Boolean(triggeredRules?.includes('R-INCOMPLETE-METADATA'));
  const isLegalResource =
    (normalizedKey === 'RESOURCE' ||
      normalizedKey === 'URL_RESOURCE' ||
      normalizedKey === 'WEB_RESOURCE') &&
    isLegalStatuteVerdict({ label: verdict, triggered_rules: triggeredRules });
  const config = resolveVerdictConfig(verdict);
  const plainVerdict = getPlainVerdictLabel(verdict, lang);
  const labelKey = Object.prototype.hasOwnProperty.call(verdictLabelKey, normalizedKey)
    ? verdictLabelKey[normalizedKey]
    : undefined;
  const labelText = isLegalResource
    ? t('verdict.legalStatute', isVi ? 'Văn bản Pháp luật' : 'Legal Statute')
    : isIncompleteMeta
      ? t(
          'verdict.incompleteReference',
          isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference',
        )
      : labelKey
        ? t(labelKey)
        : plainVerdict.label;
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
      : `${plainVerdict.label} — ${plainVerdict.actionHint}`;

  return { config, isLegalResource, labelText, descriptionText };
}

export function VerdictBadge({
  verdict,
  triggeredRules,
  size = 'md',
  showIcon = true,
  className = ''
}: VerdictBadgeProps) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const { config, isLegalResource, labelText, descriptionText } = resolveVerdictPresentation(
    verdict,
    triggeredRules,
    lang,
    t,
  );

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

// Compact version for inline use (icon only)
export function VerdictBadgeCompact({
  verdict,
  triggeredRules,
  className = ''
}: {
  verdict: VerdictType | string;
  triggeredRules?: string[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
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

// Icon-only version
export function VerdictIcon({
  verdict,
  triggeredRules,
  size = 'md',
  className = ''
}: {
  verdict: VerdictType | string;
  triggeredRules?: string[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
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
    <span
      className={`inline-flex shrink-0 ${className}`}
      title={descriptionText}
    >
      <span className={`${config.iconColor} ${iconSizes[size]}`}>
        {isLegalResource ? <Scale className={`${iconSizes[size]} shrink-0`} /> : config.icon}
      </span>
    </span>
  );
}

// Get verdict color for inline highlights (underline-based status)
export function getVerdictColor(verdict: string): string {
  const normalizedKey = normalizeVerdictKey(verdict);
  const config = Object.prototype.hasOwnProperty.call(verdictConfig, normalizedKey)
    ? verdictConfig[normalizedKey]
    : undefined;
  if (!config) return 'border-slate-300';

  const colorMap: Record<string, string> = {
    'bg-emerald-50': 'border-emerald-400',
    'bg-green-50': 'border-green-400',
    'bg-amber-50': 'border-amber-400',
    'bg-orange-50': 'border-orange-400',
    'bg-red-50': 'border-red-400',
    'bg-violet-50': 'border-violet-400',
    'bg-slate-100': 'border-slate-400',
  };

  const lightBgClass = config.bgClass.split(' ')[0];
  return colorMap[lightBgClass] || 'border-slate-300';
}

// Get underline color for document inspector (UX/UI Concept Section 13)
export function getVerdictUnderlineClass(verdict: string): string {
  const normalizedKey = normalizeVerdictKey(verdict);
  const config = Object.prototype.hasOwnProperty.call(verdictConfig, normalizedKey)
    ? verdictConfig[normalizedKey]
    : undefined;
  if (!config) return 'decoration-slate-400';

  const underlineMap: Record<string, string> = {
    'bg-emerald-50': 'decoration-emerald-500',
    'bg-green-50': 'decoration-green-500',
    'bg-amber-50': 'decoration-amber-500',
    'bg-orange-50': 'decoration-orange-500',
    'bg-red-50': 'decoration-red-500',
    'bg-violet-50': 'decoration-violet-500',
    'bg-slate-100': 'decoration-slate-400',
  };

  const lightBgClass = config.bgClass.split(' ')[0];
  return underlineMap[lightBgClass] || 'decoration-slate-400';
}
