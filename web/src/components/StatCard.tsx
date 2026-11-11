import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { NumberPopIn } from '@/components/ui/transitions';

type Color = 'indigo' | 'green' | 'amber' | 'violet' | 'rose' | 'slate';

const COLOR_MAP: Record<Color, { bg: string; text: string; ring: string }> = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/80',
    text: 'text-indigo-600 dark:text-indigo-400',
    ring: 'border-indigo-200/80 dark:border-indigo-800/80',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/80',
    text: 'text-emerald-600 dark:text-emerald-400',
    ring: 'border-emerald-200/80 dark:border-emerald-800/80',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/80',
    text: 'text-amber-600 dark:text-amber-400',
    ring: 'border-amber-200/80 dark:border-amber-800/80',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/80',
    text: 'text-violet-600 dark:text-violet-400',
    ring: 'border-violet-200/80 dark:border-violet-800/80',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/80',
    text: 'text-rose-600 dark:text-rose-400',
    ring: 'border-rose-200/80 dark:border-rose-800/80',
  },
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    ring: 'border-slate-200 dark:border-slate-800',
  },
};

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: Color;
  hint?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color = 'indigo',
  hint,
}: StatCardProps) {
  const c = COLOR_MAP[color];
  return (
    <Card className={`p-5 ${c.ring}`}>
      <div className="flex items-start gap-3.5">
        {Icon && (
          <div
            className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}
          >
            <Icon className={`h-5 w-5 ${c.text}`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            <NumberPopIn value={value} />
          </p>
          {hint && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {hint}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
