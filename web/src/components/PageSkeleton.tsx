import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * PageSkeleton — 120fps Solva Editorial IDE loading skeleton for child routes
 * rendered inside `AppLayout`'s `<main>` container.
 */
export function PageSkeleton({ announce = true }: { announce?: boolean } = {}) {
  return (
    <div
      className="space-y-6 t-skel-reveal"
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-label={announce ? 'Loading page' : undefined}
    >
      {/* Executive Header Card Skeleton */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
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

      {announce && <span className="sr-only">Loading…</span>}
    </div>
  );
}

/**
 * WorkspaceShellSkeleton — Full-viewport authenticated shell skeleton matching
 * `AppLayout` sidebar (`232px` / collapsed `72px`) + mobile top bar (`h-14`) +
 * `<main>` padding so lazy-loading `AppLayout` causes 0px layout shift.
 */
export function WorkspaceShellSkeleton() {
  let isCollapsed = false;
  if (typeof window !== 'undefined') {
    try {
      isCollapsed = window.localStorage.getItem('citra.sidebar.collapsed') === 'true';
    } catch {
      isCollapsed = false;
    }
  }

  return (
    <div
      className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-slate-50/80 dark:bg-slate-950 flex t-skel-reveal"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
    >
      {/* Mobile Top Header Bar Skeleton */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 px-3.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
        <Skeleton className="w-8 h-8 rounded-lg" />
      </div>

      {/* Desktop Sidebar Rail Skeleton */}
      <aside
        aria-hidden="true"
        className={`hidden lg:flex flex-col shrink-0 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 justify-between ${
          isCollapsed ? 'lg:w-[72px]' : 'lg:w-[232px]'
        }`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
            {!isCollapsed && <Skeleton className="h-5 w-24 rounded-md" />}
          </div>
          <div className="space-y-2 pt-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </aside>

      {/* Main Content Area Matching AppLayout Exact Padding */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <main className="pt-[4.5rem] sm:pt-20 lg:pt-8 pb-10 px-3.5 sm:px-6 lg:px-8 xl:px-10 max-w-[1440px] mx-auto w-full">
          <PageSkeleton announce={false} />
        </main>
      </div>
    </div>
  );
}

/**
 * AuthPageSkeleton — Split-screen Solva authentication skeleton matching
 * `AuthSplitShell` (`53%` warm showcase left + centered card right).
 */
export function AuthPageSkeleton() {
  return (
    <div
      className="solva-editorial-root min-h-screen flex flex-col lg:flex-row bg-[#FBFAF6] dark:bg-[#141310] t-skel-reveal"
      role="status"
      aria-live="polite"
      aria-label="Loading authentication"
    >
      <div
        aria-hidden="true"
        className="hidden lg:flex lg:w-[53%] xl:w-[55%] flex-col justify-between p-10 xl:p-14 bg-[#F4F2EC] dark:bg-[#1E1C17] border-r border-[#E7E3D9] dark:border-[#332F26]"
      >
        <Skeleton className="h-8 w-28 rounded-lg" />
        <div className="space-y-4 max-w-lg">
          <Skeleton className="h-10 w-4/5 rounded-xl" />
          <Skeleton className="h-5 w-full rounded-md" />
          <Skeleton className="h-5 w-3/4 rounded-md" />
        </div>
        <Skeleton className="h-4 w-48 rounded-md" />
      </div>
      <div className="flex-1 flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-[448px] rounded-[18px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-7 w-44 rounded-lg" />
            <Skeleton className="h-4 w-64 max-w-full rounded-md" />
          </div>
          <div className="space-y-3.5">
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * EditorialPageSkeleton — Public Solva editorial skeleton matching `/pricing`,
 * `/privacy`, `/terms`, `/verify/share/:token`, and `NotFoundPage`.
 */
export function EditorialPageSkeleton() {
  return (
    <div
      className="solva-editorial-root min-h-screen bg-[#FBFAF6] dark:bg-[#141310] t-skel-reveal"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="h-[76px] border-b border-[#E7E3D9] dark:border-[#332F26] px-4 sm:px-8 flex items-center justify-between max-w-7xl mx-auto">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <div className="hidden md:flex items-center gap-4">
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-4 w-20 rounded-md" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 pb-16 space-y-6">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-12 w-3/4 max-w-full rounded-xl" />
        <Skeleton className="h-5 w-2/3 max-w-full rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] p-6 shadow-sm space-y-4"
            >
              <Skeleton className="h-6 w-28 rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-lg" />
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-4 w-5/6 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
