import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  [
    'relative w-full rounded-2xl border p-4 overflow-hidden',
    'transform-gpu transition-[transform,opacity,box-shadow] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]',
    'shadow-[0_4px_16px_-4px_rgba(28,26,21,0.06),inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[0_6px_20px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)]',
    '[&>svg~*]:pl-7 [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[#FBFAF6]/95 dark:bg-[#1E1C17]/95 border-[#E7E3D9] dark:border-[#332F26] text-[#1C1A15] dark:text-[#FBFAF6] [&>svg]:text-slate-600 dark:[&>svg]:text-slate-400',
        destructive:
          'border-red-200/90 dark:border-red-800/75 bg-gradient-to-br from-red-50/90 via-[#FBFAF6] to-[#FBFAF6] dark:from-red-950/45 dark:via-[#1E1C17] dark:to-[#1E1C17] text-red-950 dark:text-red-100 [&>svg]:text-red-600 dark:[&>svg]:text-red-400',
        warning:
          'border-amber-200/90 dark:border-amber-800/75 bg-gradient-to-br from-amber-50/90 via-[#FBFAF6] to-[#FBFAF6] dark:from-amber-950/45 dark:via-[#1E1C17] dark:to-[#1E1C17] text-amber-950 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
        success:
          'border-emerald-200/90 dark:border-emerald-800/75 bg-gradient-to-br from-emerald-50/90 via-[#FBFAF6] to-[#FBFAF6] dark:from-emerald-950/45 dark:via-[#1E1C17] dark:to-[#1E1C17] text-emerald-950 dark:text-emerald-100 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400',
        info:
          'border-[#E7E3D9] dark:border-[#332F26] bg-gradient-to-br from-[#F4F2EC] via-[#FBFAF6] to-[#FBFAF6] dark:from-[#29261F] dark:via-[#1E1C17] dark:to-[#1E1C17] text-[#1C1A15] dark:text-[#FBFAF6] [&>svg]:text-indigo-600 dark:[&>svg]:text-indigo-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-semibold leading-tight tracking-[-0.01em]', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm leading-relaxed opacity-90 [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
