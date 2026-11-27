import {
  Link,
  Unlink,
  AlertTriangle,
  CheckCircle,
  XCircle,
  HelpCircle,
  MinusCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getMappingStatusDisplay,
  normalizeMappingStatusKey,
  resolveAcademicLang,
  type CanonicalMappingStatusKey,
} from '@/lib/academicTaxonomy';

export type MappingStatus = CanonicalMappingStatusKey;

interface Props {
  status: MappingStatus | string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

interface MappingVisualSpec {
  className: string;
  Icon: typeof Link;
}

const MAPPING_VISUALS: Record<CanonicalMappingStatusKey, MappingVisualSpec> = {
  matched: {
    className: 'mapping-badge-matched',
    Icon: CheckCircle,
  },
  missing_reference: {
    className: 'mapping-badge-missing',
    Icon: Unlink,
  },
  uncited_reference: {
    className: 'mapping-badge-uncited',
    Icon: AlertTriangle,
  },
  in_text_mismatch: {
    className: 'mapping-badge-mismatch',
    Icon: XCircle,
  },
  duplicate_reference: {
    className: 'mapping-badge-duplicate',
    Icon: AlertTriangle,
  },
  ambiguous_mapping: {
    className: 'mapping-badge-ambiguous',
    Icon: HelpCircle,
  },
  style_inconsistent: {
    className: 'mapping-badge-style',
    Icon: AlertTriangle,
  },
  unresolved: {
    className: 'mapping-badge-unresolved',
    Icon: Unlink,
  },
  not_applicable: {
    className: 'mapping-badge-unresolved',
    Icon: MinusCircle,
  },
};

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
};

export function MappingStatusBadge({ status, showIcon = true, size = 'md' }: Props) {
  const { i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const canonicalKey = normalizeMappingStatusKey(status);
  const display = getMappingStatusDisplay(canonicalKey, lang);
  const { className, Icon } = MAPPING_VISUALS[canonicalKey];

  return (
    <span
      className={`mapping-badge whitespace-nowrap shrink-0 ${className} ${sizeClasses[size]}`}
      title={`${display.label} — ${display.description}`}
    >
      {showIcon && <Icon className="h-3 w-3 shrink-0" />}
      {display.label}
    </span>
  );
}

export function MappingStatusBadgeCompact({ status }: { status: MappingStatus | string }) {
  const { i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const canonicalKey = normalizeMappingStatusKey(status);
  const display = getMappingStatusDisplay(canonicalKey, lang);
  const { className, Icon } = MAPPING_VISUALS[canonicalKey];

  return (
    <span
      className={`mapping-badge shrink-0 ${className} w-6 h-6 flex items-center justify-center`}
      title={`${display.label} — ${display.description}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
    </span>
  );
}
