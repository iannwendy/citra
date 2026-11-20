import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from './separator';
import { useSlidingPill } from './transitions';

/**
 * Consistent 3-dot window header matching DashboardPage's `RECENT ACTIVITY` bar:
 * keeps the red/amber/emerald window dots + vertical separator, removes `<Terminal />`
 * and code filenames (`*.queue`, `*.json`), and displays an UPPERCASE human title.
 */
export function StudioWindowHeader({
  title,
  badge,
  rightSlot,
  className,
}: {
  title: string;
  badge?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'px-4 sm:px-5 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
        </div>
        <Separator orientation="vertical" className="h-4 shrink-0" />
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          {title}
        </span>
        {badge}
      </div>
      {rightSlot && (
        <div className="flex flex-wrap items-center gap-2 min-w-0">{rightSlot}</div>
      )}
    </div>
  );
}

/**
 * 120Hz GPU-composited sliding segmented filter bar powered by `useSlidingPill`.
 */
export function SlidingFilterPills<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: Array<{
    key: K;
    label: React.ReactNode;
    testId?: string;
  }>;
  value: K;
  onChange: (next: K) => void;
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  const { containerRef, pillStyle } = useSlidingPill<HTMLDivElement>(value);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        't-tabs relative inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80',
        className,
      )}
    >
      {pillStyle.ready && (
        <span
          aria-hidden="true"
          style={{
            transform: `translate3d(${pillStyle.left}px, ${pillStyle.top}px, 0)`,
            width: `${pillStyle.width}px`,
            height: `${pillStyle.height}px`,
            transition: pillStyle.animate
              ? 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1), width 250ms cubic-bezier(0.22, 1, 0.36, 1), height 250ms cubic-bezier(0.22, 1, 0.36, 1)'
              : 'none',
          }}
          className="t-tabs-pill pointer-events-none absolute left-0 top-0 rounded-lg bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10"
        />
      )}
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            data-testid={opt.testId}
            data-pill-active={active ? 'true' : 'false'}
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              'relative z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
              active
                ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Smooth CSS-transitioned proportional bar row for human-friendly rankings & distributions.
 */
export function ProportionalBarRow({
  label,
  count,
  value,
  max,
  barClass = 'bg-indigo-500',
  sublabel,
  testId,
}: {
  label: React.ReactNode;
  count: number | string;
  value: number;
  max: number;
  barClass?: string;
  sublabel?: React.ReactNode;
  testId?: string;
}): JSX.Element {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? (value / safeMax) * 100 : 0));

  return (
    <div
      data-testid={testId}
      className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-800 dark:text-slate-200 min-w-0 truncate">
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {sublabel && (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              {sublabel}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">
            {count}
          </span>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
        <div
          style={{
            width: `${pct.toFixed(1)}%`,
            transition: 'width 420ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className={cn('h-full rounded-full', barClass)}
        />
      </div>
    </div>
  );
}

export interface PipelineStageNode {
  id: string;
  stepLabel: string;
  title: string;
  metric: React.ReactNode;
  statusText: string;
  level: 'healthy' | 'degraded' | 'down';
  icon: React.ReactNode;
  actionSlot?: React.ReactNode;
}

/**
 * 3-Stage interactive architecture pulse diagram for SystemHealthPage.
 * Stacks vertically on small screens (< md) with zero horizontal overflow,
 * and connects horizontally with animated flow arrows on desktop.
 */
export function PipelineStageFlow({
  stages,
  'data-testid': testId,
}: {
  stages: PipelineStageNode[];
  'data-testid'?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2.5 sm:gap-3"
    >
      {stages.map((stage, idx) => {
        const dotClass =
          stage.level === 'healthy'
            ? 'bg-emerald-500'
            : stage.level === 'degraded'
              ? 'bg-amber-500 animate-pulse'
              : 'bg-rose-500 animate-pulse';
        const pillClass =
          stage.level === 'healthy'
            ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
            : stage.level === 'degraded'
              ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/70 text-amber-700 dark:text-amber-300'
              : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/70 text-rose-700 dark:text-rose-300';

        return (
          <React.Fragment key={stage.id}>
            <div className="relative rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                    {stage.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {stage.stepLabel}
                    </p>
                    <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {stage.title}
                    </h3>
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0',
                    pillClass,
                  )}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full', dotClass)} />
                  {stage.statusText}
                </span>
              </div>

              <div className="flex items-end justify-between gap-2 pt-1">
                <div className="min-w-0">{stage.metric}</div>
                {stage.actionSlot}
              </div>
            </div>

            {idx < stages.length - 1 && (
              <div
                aria-hidden="true"
                className="hidden md:flex items-center justify-center px-0.5 text-indigo-400 dark:text-indigo-500"
              >
                <div className="flex items-center gap-1">
                  <span className="w-4 h-px bg-gradient-to-r from-slate-300 to-indigo-400 dark:from-slate-700 dark:to-indigo-500" />
                  <ArrowRight className="h-4 w-4 animate-pulse" />
                  <span className="w-4 h-px bg-gradient-to-r from-indigo-400 to-slate-300 dark:from-indigo-500 dark:to-slate-700" />
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
