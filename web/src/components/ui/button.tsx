import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold select-none',
    'transform-gpu transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:translate-y-0 active:scale-[0.968] active:duration-75',
    '[&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-[cubic-bezier(0.22,1,0.36,1)]',
    '[&:hover_svg.lucide-arrow-right]:translate-x-0.5 [&:hover_svg.lucide-arrow-left]:-translate-x-0.5',
    '[&:hover_svg.lucide-sparkles]:scale-110 [&:hover_svg.lucide-sparkles]:rotate-6',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-indigo-600 text-white hover:-translate-y-[1px] hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 shadow-[0_1px_2px_rgba(28,26,21,0.08),0_4px_12px_-2px_rgba(28,26,21,0.16),inset_0_1px_0_rgba(255,255,255,0.22)] hover:shadow-[0_2px_5px_rgba(28,26,21,0.12),0_8px_20px_-4px_rgba(28,26,21,0.24),inset_0_1px_0_rgba(255,255,255,0.32)]',
        destructive:
          'bg-red-600 text-white hover:-translate-y-[1px] hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 shadow-[0_1px_2px_rgba(220,38,38,0.15),0_4px_12px_-2px_rgba(220,38,38,0.22),inset_0_1px_0_rgba(255,255,255,0.22)] hover:shadow-[0_6px_18px_-3px_rgba(220,38,38,0.34),inset_0_1px_0_rgba(255,255,255,0.3)]',
        outline:
          'border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:-translate-y-[1px] hover:bg-slate-50 dark:hover:bg-slate-800/90 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-white shadow-[0_1px_2px_rgba(28,26,21,0.04),inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] hover:shadow-[0_4px_12px_-3px_rgba(28,26,21,0.09)]',
        secondary:
          'bg-slate-100 text-slate-900 hover:-translate-y-[1px] hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        ghost:
          'rounded-lg font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100/90 dark:hover:bg-slate-800/90 hover:text-slate-900 dark:hover:text-slate-100',
        link: 'text-indigo-600 dark:text-indigo-400 underline-offset-4 hover:underline p-0 h-auto active:scale-100',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-xl px-6 text-base',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
