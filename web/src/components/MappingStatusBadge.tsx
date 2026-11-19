import { Link, Unlink, AlertTriangle, CheckCircle, XCircle, HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPlainMappingLabel } from '@/lib/verdictExplanation';

// Mapping status types based on UX/UI concept
export type MappingStatus =
  | 'matched'
  | 'missing_reference'
  | 'uncited_reference'
  | 'in_text_mismatch'
  | 'duplicate_reference'
  | 'ambiguous_mapping'
  | 'style_inconsistent'
  | 'unresolved';

interface Props {
  status: MappingStatus | string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

interface MappingBadgeEntry {
  key: string;
  label: string;
  className: string;
  Icon: typeof Link;
}

// Mapping status configuration based on SourceLogic design system (canonical lowercase keys)
const config: Record<string, MappingBadgeEntry> = {
  matched: {
    key: 'mappingStatus.matched',
    label: 'Linked',
    className: 'mapping-badge-matched',
    Icon: CheckCircle,
  },
  missing_reference: {
    key: 'mappingStatus.missing_reference',
    label: 'No Reference',
    className: 'mapping-badge-missing',
    Icon: Unlink,
  },
  uncited_reference: {
    key: 'mappingStatus.uncited_reference',
    label: 'Not Cited',
    className: 'mapping-badge-uncited',
    Icon: AlertTriangle,
  },
  in_text_mismatch: {
    key: 'mappingStatus.in_text_mismatch',
    label: 'Mismatch',
    className: 'mapping-badge-mismatch',
    Icon: XCircle,
  },
  duplicate_reference: {
    key: 'mappingStatus.duplicate_reference',
    label: 'Duplicate',
    className: 'mapping-badge-duplicate',
    Icon: AlertTriangle,
  },
  ambiguous_mapping: {
    key: 'mappingStatus.ambiguous_mapping',
    label: 'Ambiguous',
    className: 'mapping-badge-ambiguous',
    Icon: HelpCircle,
  },
  style_inconsistent: {
    key: 'mappingStatus.style_inconsistent',
    label: 'Style Issue',
    className: 'mapping-badge-style',
    Icon: AlertTriangle,
  },
  unresolved: {
    key: 'mappingStatus.unresolved',
    label: 'Unresolved',
    className: 'mapping-badge-unresolved',
    Icon: Unlink,
  },
};

const statusAliases: Record<string, string> = {
  linked: 'matched',
  missing: 'missing_reference',
  missing_ref: 'missing_reference',
  uncited: 'uncited_reference',
  uncited_ref: 'uncited_reference',
  mismatch: 'in_text_mismatch',
  duplicate: 'duplicate_reference',
  ambiguous: 'ambiguous_mapping',
  style: 'style_inconsistent',
  style_issue: 'style_inconsistent',
};

function resolveMappingEntry(status: string): MappingBadgeEntry {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const canonical = Object.prototype.hasOwnProperty.call(statusAliases, normalized)
    ? statusAliases[normalized]
    : normalized;
  return Object.prototype.hasOwnProperty.call(config, canonical)
    ? config[canonical]
    : config.unresolved;
}

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
};

export function MappingStatusBadge({ status, showIcon = true, size = 'md' }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const entry = resolveMappingEntry(status);
  const { key, label, className, Icon } = entry;
  const plainMapping = getPlainMappingLabel(status, lang);

  return (
    <span
      className={`mapping-badge whitespace-nowrap shrink-0 ${className} ${sizeClasses[size]}`}
      title={`${plainMapping.label} — ${plainMapping.actionHint}`}
    >
      {showIcon && <Icon className="h-3 w-3 shrink-0" />}
      {t(key, label)}
    </span>
  );
}

// Compact version for inline use
export function MappingStatusBadgeCompact({ status }: { status: MappingStatus | string }) {
  const { i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const entry = resolveMappingEntry(status);
  const { className, Icon } = entry;
  const plainMapping = getPlainMappingLabel(status, lang);

  return (
    <span
      className={`mapping-badge shrink-0 ${className} w-6 h-6 flex items-center justify-center`}
      title={`${plainMapping.label} — ${plainMapping.actionHint}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
    </span>
  );
}
