import * as React from 'react';
import { cn } from '../../lib/utils';

export interface TooltipProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'content'> {
  content: React.ReactNode;
}

const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('group relative inline-flex', className)}
      {...props}
    >
      {children}
      {content && (
        <span
          role="tooltip"
          className="t-tt-bubble absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-max max-w-[min(240px,75vw)] whitespace-normal text-center leading-snug rounded-lg bg-slate-900 dark:bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-slate-900 shadow-md"
        >
          {content}
        </span>
      )}
    </div>
  )
);
Tooltip.displayName = 'Tooltip';

export { Tooltip };
