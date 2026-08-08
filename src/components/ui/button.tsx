'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-w-0 items-center justify-center gap-2 rounded-[var(--radius-input)] text-sm font-medium transition-[background-color,color,border-color,opacity,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none active:translate-y-px motion-reduce:active:translate-y-0',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-800 text-white hover:bg-brand-700 active:bg-brand-900 dark:bg-brand-800 dark:hover:bg-brand-700',
        secondary:
          'border border-border bg-surface text-ink-700 hover:bg-muted hover:text-ink-950 active:bg-border',
        tertiary: 'text-ink-700 hover:bg-muted hover:text-ink-950 active:bg-border',
        destructive:
          'bg-status-error-text text-white hover:opacity-90 active:opacity-80',
        ghost: 'text-ink-500 hover:bg-muted hover:text-ink-800',
        outline:
          'border border-border bg-transparent text-ink-700 hover:bg-muted hover:text-ink-950',
        emergency:
          'bg-status-emergency-text text-white hover:opacity-90 active:opacity-80',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'min-h-11 px-3 text-xs sm:min-h-9',
        lg: 'h-11 px-6 text-base',
        compact: 'min-h-11 px-3 sm:min-h-9',
        icon: 'h-11 w-11 p-0 sm:h-10 sm:w-10',
        'icon-sm': 'h-11 w-11 p-0 sm:h-9 sm:w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, asChild, children, ...props }, ref) => {
    if (asChild) {
      const child = React.Children.toArray(children).find(React.isValidElement) as
        React.ReactElement<{ className?: string }> | undefined;
      if (!child) return null;
      return React.cloneElement(child, {
        className: cn(buttonVariants({ variant, size }), child.props.className, className),
        ref,
        ...props,
      } as Record<string, unknown>);
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
