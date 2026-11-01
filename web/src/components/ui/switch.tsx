import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, onClick, ...props }, ref) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      ref={ref}
      onClick={(e) => {
        onCheckedChange?.(!checked);
        onClick?.(e);
      }}
      className={cn(
        'group peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent select-none',
        'transform-gpu transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2',
        'active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'bg-indigo-600 shadow-[inset_0_1px_1px_rgba(0,0,0,0.15),0_2px_8px_-2px_rgba(28,26,21,0.25)]'
          : 'bg-slate-200 dark:bg-slate-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]',
        className
      )}
      {...props}
    >
      <span
        data-state={checked ? 'checked' : 'unchecked'}
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white dark:bg-slate-950 ring-0',
          'shadow-[0_1px_3px_rgba(0,0,0,0.22),0_1px_1px_rgba(0,0,0,0.12)]',
          'transform-gpu transition-transform duration-250 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'group-active:scale-x-110',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  )
);
Switch.displayName = 'Switch';

export { Switch };
