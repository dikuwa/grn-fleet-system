'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[8px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-800 text-white hover:bg-brand-700 active:bg-brand-900',
        secondary:
          'border border-border bg-surface text-ink-700 hover:bg-muted active:bg-border',
        tertiary: 'text-ink-700 hover:bg-muted active:bg-border',
        destructive:
          'bg-status-error-text text-white hover:bg-red-700 active:bg-red-800',
        ghost: 'text-ink-500 hover:text-ink-700 hover:bg-muted',
        outline:
          'border border-border bg-transparent text-ink-700 hover:bg-muted',
        emergency:
          'bg-status-emergency-text text-white hover:bg-rose-700 active:bg-rose-800',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        compact: 'h-9 px-3',
        icon: 'h-10 w-10',
        'icon-sm': 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, asChild, children, ...props }, ref) => {
    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{ className?: string }>;
      return React.cloneElement(
        child,
        {
          className: cn(buttonVariants({ variant, size }), child.props.className, className),
          ref,
          ...props,
        } as Record<string, unknown>,
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
