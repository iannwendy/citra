import { Link, Unlink, AlertTriangle, CheckCircle, XCircle, HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

// Mapping status configuration based on SourceLogic design system
const config: Record<string, { key: string; label: string; className: string; Icon: typeof Link }> = {
  matched: {
    key: 'mappingStatus.matched',
    label: 'Linked',
    className: 'mapping-badge-matched',
    Icon: CheckCircle
  },
  missing_reference: {
    key: 'mappingStatus.missing_reference',
    label: 'No Reference',
    className: 'mapping-badge-missing',
    Icon: Unlink
  },
  uncited_reference: {
    key: 'mappingStatus.uncited_reference',
    label: 'Not Cited',
    className: 'mapping-badge-uncited',
    Icon: AlertTriangle
  },
  in_text_mismatch: {
    key: 'mappingStatus.in_text_mismatch',
    label: 'Mismatch',
    className: 'mapping-badge-mismatch',
    Icon: XCircle
  },
  duplicate_reference: {
    key: 'mappingStatus.duplicate_reference',
    label: 'Duplicate',
    className: 'mapping-badge-duplicate',
    Icon: AlertTriangle
  },
  ambiguous_mapping: {
    key: 'mappingStatus.ambiguous_mapping',
    label: 'Ambiguous',
    className: 'mapping-badge-ambiguous',
    Icon: HelpCircle
  },
  style_inconsistent: {
    key: 'mappingStatus.style_inconsistent',
    label: 'Style Issue',
    className: 'mapping-badge-style',
    Icon: AlertTriangle
  },
  unresolved: {
    key: 'mappingStatus.unresolved',
    label: 'Unresolved',
    className: 'mapping-badge-unresolved',
    Icon: Unlink
  },
  // Legacy mappings
  MATCHED: { key: 'mappingStatus.matched', label: 'Linked', className: 'mapping-badge-matched', Icon: CheckCircle },
  MISSING: { key: 'mappingStatus.missing_reference', label: 'No Reference', className: 'mapping-badge-missing', Icon: Unlink },
  UNCITED: { key: 'mappingStatus.uncited_reference', label: 'Not Cited', className: 'mapping-badge-uncited', Icon: AlertTriangle },
  MISMATCH: { key: 'mappingStatus.in_text_mismatch', label: 'Mismatch', className: 'mapping-badge-mismatch', Icon: XCircle },
  UNRESOLVED: { key: 'mappingStatus.unresolved', label: 'Unresolved', className: 'mapping-badge-unresolved', Icon: Unlink },
};

const sizeClasses = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
};

export function MappingStatusBadge({ status, showIcon = true, size = 'md' }: Props) {
  const { t } = useTranslation();
  const entry = config[status] || config.unresolved;
  const { key, label, className, Icon } = entry;

  return (
    <span className={`mapping-badge ${className} ${sizeClasses[size]}`}>
      {showIcon && <Icon className="h-3 w-3" />}
      {t(key, label)}
    </span>
  );
}

// Compact version for inline use
export function MappingStatusBadgeCompact({ status }: { status: MappingStatus | string }) {
  const { t } = useTranslation();
  const entry = config[status] || config.unresolved;
  const { key, label, className, Icon } = entry;

  return (
    <span
      className={`mapping-badge ${className} w-6 h-6 flex items-center justify-center`}
      title={t(key, label)}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}
