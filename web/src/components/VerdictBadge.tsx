import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, AlertCircle, XCircle, HelpCircle, Link2 } from 'lucide-react';

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
const verdictConfig: Record<string, {
  icon: React.ReactNode;
  label: string;
  description: string;
  bgClass: string;
  borderClass: string;
  iconColor: string;
}> = {
  // Main verdict types (from UX/UI concept)
  VERIFIED: {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    label: 'Verified',
    description: 'Publication exists and metadata is consistent',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  LIKELY_VERIFIED: {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    label: 'Likely Verified',
    description: 'Strong candidate but missing some identifiers',
    bgClass: 'bg-green-50 dark:bg-green-950',
    borderClass: 'border-green-200 dark:border-green-800',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  METADATA_ERROR: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: 'Metadata Error',
    description: 'Source exists but citation has incorrect metadata',
    bgClass: 'bg-amber-50 dark:bg-amber-950',
    borderClass: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  SOURCE_MISMATCH: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    label: 'Source Mismatch',
    description: 'Citation appears to reference a different publication',
    bgClass: 'bg-orange-50 dark:bg-orange-950',
    borderClass: 'border-orange-200 dark:border-orange-800',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  HALLUCINATED: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: 'Likely Hallucinated',
    description: 'No matching publication found across databases',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  SUSPECTED_HALLUCINATION: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: 'Suspected',
    description: 'Potentially hallucinated source detected',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  UNVERIFIABLE: {
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    label: 'Unverifiable',
    description: 'Insufficient data to conclude',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  UNRESOLVED: {
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    label: 'Unresolved',
    description: 'Pending verification',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  RESOURCE: {
    icon: <Link2 className="h-3.5 w-3.5" />,
    label: 'URL Resource',
    description: 'URL or reference link, excluded from academic citation scoring',
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  // Legacy lowercase mappings (from API)
  verified: {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    label: 'Verified',
    description: 'Source verified',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  metadata_error: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: 'Metadata Error',
    description: 'Metadata mismatch',
    bgClass: 'bg-amber-50 dark:bg-amber-950',
    borderClass: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  source_mismatch: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    label: 'Source Mismatch',
    description: 'Source mismatch',
    bgClass: 'bg-orange-50 dark:bg-orange-950',
    borderClass: 'border-orange-200 dark:border-orange-800',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  suspected_hallucination: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: 'Suspected',
    description: 'Suspected hallucination',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  hallucinated: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: 'Likely Hallucinated',
    description: 'Likely hallucinated',
    bgClass: 'bg-red-50 dark:bg-red-950',
    borderClass: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  unresolved: {
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    label: 'Unresolved',
    description: 'Unresolved',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  resource: {
    icon: <Link2 className="h-3.5 w-3.5" />,
    label: 'URL Resource',
    description: 'URL or reference link, excluded from academic citation scoring',
    bgClass: 'bg-violet-50 dark:bg-violet-950',
    borderClass: 'border-violet-200 dark:border-violet-800',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
};

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-3 py-1 gap-1.5',
  lg: 'text-sm px-4 py-1.5 gap-2',
};

const verdictLabelKey: Record<string, string> = {
  VERIFIED: 'verdict.verified',
  verified: 'verdict.verified',
  LIKELY_VERIFIED: 'verdict.likelyVerified',
  METADATA_ERROR: 'verdict.metadataError',
  metadata_error: 'verdict.metadataError',
  SOURCE_MISMATCH: 'verdict.sourceMismatch',
  source_mismatch: 'verdict.sourceMismatch',
  HALLUCINATED: 'verdict.likelyHallucinated',
  hallucinated: 'verdict.likelyHallucinated',
  SUSPECTED_HALLUCINATION: 'essay.suspected',
  suspected_hallucination: 'essay.suspected',
  UNVERIFIABLE: 'essay.unverifiable',
  UNRESOLVED: 'verdict.unresolved',
  unresolved: 'verdict.unresolved',
  RESOURCE: 'essay.urlResource',
  resource: 'essay.urlResource',
};

export function VerdictBadge({
  verdict,
  triggeredRules,
  size = 'md',
  showIcon = true,
  className = ''
}: VerdictBadgeProps) {
  const { t, i18n } = useTranslation();
  const isVi = i18n.language?.startsWith('vi');
  const isIncompleteMeta =
    (verdict === 'METADATA_ERROR' || verdict === 'metadata_error') &&
    Boolean(triggeredRules?.includes('R-INCOMPLETE-METADATA'));
  const config = verdictConfig[verdict] || verdictConfig.UNVERIFIABLE;
  const labelKey = verdictLabelKey[verdict];
  const labelText = isIncompleteMeta
    ? t(
        'verdict.incompleteReference',
        isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference',
      )
    : labelKey
      ? t(labelKey)
      : config.label;
  const descriptionText = isIncompleteMeta
    ? t(
        'verdict.incompleteReferenceDesc',
        isVi
          ? 'Mục tham khảo thiếu các trường bắt buộc (tác giả, năm xuất bản hoặc nơi công bố) chứ không phải nguồn do AI bịa đặt.'
          : 'Citation lacks required bibliographic fields (author, publication year, or academic venue) rather than being fabricated.',
      )
    : config.description;

  return (
    <span
      className={`
        inline-flex items-center rounded-full font-semibold
        ${config.bgClass} ${config.borderClass} border
        ${sizeClasses[size]}
        ${className}
      `}
      title={descriptionText}
    >
      {showIcon && (
        <span className={config.iconColor}>
          {config.icon}
        </span>
      )}
      <span className={config.iconColor}>{labelText}</span>
    </span>
  );
}

// Compact version for inline use (icon only)
export function VerdictBadgeCompact({
  verdict,
  className = ''
}: {
  verdict: VerdictType | string;
  className?: string;
}) {
  const config = verdictConfig[verdict] || verdictConfig.UNVERIFIABLE;

  return (
    <span
      className={`
        inline-flex items-center justify-center rounded-full
        ${config.bgClass} ${config.borderClass} border
        w-6 h-6
        ${className}
      `}
      title={config.description}
    >
      <span className={config.iconColor}>
        {config.icon}
      </span>
    </span>
  );
}

// Icon-only version
export function VerdictIcon({
  verdict,
  size = 'md',
  className = ''
}: {
  verdict: VerdictType | string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const config = verdictConfig[verdict] || verdictConfig.UNVERIFIABLE;

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <span
      className={`inline-flex ${className}`}
      title={`${config.label}: ${config.description}`}
    >
      <span className={`${config.iconColor} ${iconSizes[size]}`}>
        {config.icon}
      </span>
    </span>
  );
}

// Get verdict color for inline highlights (underline-based status)
export function getVerdictColor(verdict: string): string {
  const config = verdictConfig[verdict];
  if (!config) return 'border-slate-300';

  const colorMap: Record<string, string> = {
    'bg-emerald-50': 'border-emerald-400',
    'bg-green-50': 'border-green-400',
    'bg-amber-50': 'border-amber-400',
    'bg-orange-50': 'border-orange-400',
    'bg-red-50': 'border-red-400',
    'bg-slate-100': 'border-slate-400',
  };

  return colorMap[config.bgClass] || 'border-slate-300';
}

// Get underline color for document inspector (UX/UI Concept Section 13)
export function getVerdictUnderlineClass(verdict: string): string {
  const config = verdictConfig[verdict];
  if (!config) return 'decoration-slate-400';

  const underlineMap: Record<string, string> = {
    'bg-emerald-50': 'decoration-emerald-500',
    'bg-green-50': 'decoration-green-500',
    'bg-amber-50': 'decoration-amber-500',
    'bg-orange-50': 'decoration-orange-500',
    'bg-red-50': 'decoration-red-500',
    'bg-slate-100': 'decoration-slate-400',
  };

  return underlineMap[config.bgClass] || 'decoration-slate-400';
}
