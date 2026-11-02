import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

/**
 * Native-backed accessible Select primitive styled to match shadcn/ui.
 * Preserves native `<select>` semantics so Playwright `.selectOption()` and mobile/screen-reader
 * controls work out of the box.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    const isFullWidth =
      Boolean(className?.includes('w-full')) ||
      Boolean(wrapperClassName?.includes('w-full'));
    return (
      <div
        className={cn(
          'relative inline-flex items-center min-w-0',
          isFullWidth && 'flex w-full',
          wrapperClassName
        )}
      >
        <select
          ref={ref}
          className={cn(
            'flex h-10 w-full min-w-0 appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3.5 pr-9 py-2 text-sm text-slate-900 dark:text-slate-100 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-400" />
      </div>
    );
  }
);
Select.displayName = 'Select';

export { Select };
