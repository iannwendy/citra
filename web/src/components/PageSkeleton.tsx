import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * PageSkeleton — 120fps Solva Editorial IDE loading skeleton for lazy-loaded routes.
 *
 * Used as the Suspense fallback for React.lazy() route imports. Renders a
 * scholarly workspace placeholder matching CITRA's macOS window chrome so
 * route transitions feel instantaneous with zero layout shift.
 */
export function PageSkeleton() {
  return (
    <div
      className="space-y-6 t-skel-reveal"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      {/* Executive Header Card Skeleton */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2.5 mb-3">
          <Skeleton className="h-5 w-44 rounded-lg" />
          <Skeleton className="h-5 w-20 rounded-lg" />
        </div>
        <div className="flex items-center gap-3.5">
          <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
          <div className="space-y-2 flex-1 min-w-0">
            <Skeleton className="h-7 w-52 max-w-full rounded-lg" />
            <Skeleton className="h-4 w-80 max-w-full rounded-md" />
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card
            key={i}
            className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900"
          >
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-4 w-7 rounded-md" />
            </div>
            <Skeleton className="h-7 w-20 mb-2 rounded-lg" />
            <Skeleton className="h-3.5 w-28 rounded-md" />
          </Card>
        ))}
      </div>

      {/* Main IDE Window Card */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
            </div>
            <Skeleton className="h-4 w-36 rounded-md ml-2" />
          </div>
          <Skeleton className="h-4 w-12 rounded-md" />
        </div>
        <div className="p-6 space-y-4">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-3/4 rounded-xl" />
        </div>
      </Card>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
