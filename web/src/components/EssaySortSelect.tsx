import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DEFAULT_ESSAY_SORT,
  isValidEssaySortOption,
  type EssaySortOption,
} from '@/lib/essaySort';

interface EssaySortSelectProps {
  value: EssaySortOption;
  onChange: (next: EssaySortOption) => void;
  className?: string;
}

export function EssaySortSelect({
  value,
  onChange,
  className,
}: EssaySortSelectProps) {
  const { t } = useTranslation();
  const isCustomSort = value !== DEFAULT_ESSAY_SORT;

  return (
    <div
      className={cn(
        'relative w-full sm:w-52 xl:w-48 2xl:w-52 shrink-0 min-w-0',
        className,
      )}
    >
      <ArrowUpDown
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 h-3.5 w-3.5 transition-colors',
          isCustomSort
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-400 dark:text-slate-500',
        )}
        aria-hidden="true"
      />
      <Select
        data-testid="essay-sort-select"
        aria-label={t('dashboard.sortAriaLabel')}
        value={value}
        onChange={(e) => {
          if (isValidEssaySortOption(e.target.value)) {
            onChange(e.target.value);
          }
        }}
        wrapperClassName="w-full"
        className={cn(
          'h-9 w-full pl-8 pr-8 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800',
          isCustomSort &&
            'border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold',
        )}
      >
        <option value="date_desc">{t('dashboard.sortDateDesc')}</option>
        <option value="date_asc">{t('dashboard.sortDateAsc')}</option>
        <option value="name_asc">{t('dashboard.sortNameAsc')}</option>
        <option value="name_desc">{t('dashboard.sortNameDesc')}</option>
        <option value="cis_desc">{t('dashboard.sortCisDesc')}</option>
        <option value="cis_asc">{t('dashboard.sortCisAsc')}</option>
        <option value="pages_desc">{t('dashboard.sortPagesDesc')}</option>
        <option value="pages_asc">{t('dashboard.sortPagesAsc')}</option>
      </Select>
    </div>
  );
}
