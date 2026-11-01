import * as React from 'react';
import { cn } from '../../lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'skeleton rounded-xl bg-slate-200/80 dark:bg-slate-800/90',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
