import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../lib/utils';

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indicatorClassName, ...props }, ref) => {
  const safeVal = Math.max(0, Math.min(100, value || 0));
  const isInFlight = safeVal > 0 && safeVal < 100;

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        'relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]',
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'relative h-full w-full flex-1 bg-indigo-600 rounded-full overflow-hidden transform-gpu transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          indicatorClassName
        )}
        style={{ transform: `translate3d(-${100 - safeVal}%, 0, 0)` }}
      >
        {isInFlight && (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer-wave"
          />
        )}
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
