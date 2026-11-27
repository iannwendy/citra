import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Link2,
} from 'lucide-react';
import type { ValidationLabel, Verdict } from '@/api/client';
import { getVerdictDisplay } from '@/lib/academicTaxonomy';
import { isLegalStatuteVerdict } from '@/lib/verdictExplanation';

export interface VerdictConfig {
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  labelVi: string;
}

export const VERDICT_CONFIG: Record<ValidationLabel, VerdictConfig> = {
  verified: {
    icon: CheckCircle2,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
    label: getVerdictDisplay('verified', 'en').label,
    labelVi: getVerdictDisplay('verified', 'vi').label,
  },
  metadata_error: {
    icon: AlertTriangle,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950',
    borderColor: 'border-amber-300 dark:border-amber-700',
    label: getVerdictDisplay('metadata_error', 'en').label,
    labelVi: getVerdictDisplay('metadata_error', 'vi').label,
  },
  suspected_hallucination: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950',
    borderColor: 'border-red-300 dark:border-red-700',
    label: getVerdictDisplay('suspected_hallucination', 'en').label,
    labelVi: getVerdictDisplay('suspected_hallucination', 'vi').label,
  },
  unresolved: {
    icon: HelpCircle,
    color: 'text-slate-600 dark:text-slate-400',
    bgColor: 'bg-slate-50 dark:bg-slate-800',
    borderColor: 'border-slate-300 dark:border-slate-600',
    label: getVerdictDisplay('unresolved', 'en').label,
    labelVi: getVerdictDisplay('unresolved', 'vi').label,
  },
  resource: {
    icon: Link2,
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-50 dark:bg-violet-950',
    borderColor: 'border-violet-300 dark:border-violet-700',
    label: getVerdictDisplay('resource', 'en').label,
    labelVi: getVerdictDisplay('resource', 'vi').label,
  },
};

export function getVerdictNodeTitle(
  verdict: Pick<Verdict, 'label' | 'triggered_rules'> & {
    matched_sources?: Verdict['matched_sources'];
  },
  isVi = false,
): string {
  const rules = verdict.triggered_rules ?? [];
  if (verdict.label === 'metadata_error' && rules.includes('R-INCOMPLETE-METADATA')) {
    return isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference';
  }
  if (verdict.label === 'resource' && isLegalStatuteVerdict(verdict as Verdict)) {
    return isVi ? 'Văn bản pháp luật' : 'Legal Statute';
  }
  return getVerdictDisplay(verdict.label, isVi ? 'vi' : 'en').label;
}
