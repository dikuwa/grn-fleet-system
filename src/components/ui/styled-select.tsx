'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * StyledSelect provides a native <select> element styled to match the
 * shadcn/Radix Select component. This is needed for filter forms that
 * use native form submission with URL params (name + defaultValue).
 *
 * For fully client-side usage, prefer the Radix-based Select component
 * from '@/components/ui/select' which requires 'use client'.
 */
export interface StyledSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Placeholder option shown when no value is selected */
  placeholder?: string;
  /** Error state */
  error?: string;
  /** Wrapper className */
  wrapperClassName?: string;
}

const StyledSelect = React.forwardRef<HTMLSelectElement, StyledSelectProps>(
  ({ className, children, placeholder, error, wrapperClassName, ...props }, ref) => {
    return (
      <div className={cn('relative', wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            'h-10 w-full appearance-none rounded-[8px] border border-border bg-surface px-3 pr-8 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
            error && 'border-status-error-text focus:ring-status-error-text',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    );
  },
);
StyledSelect.displayName = 'StyledSelect';

/**
 * StyledNativeDate - date input styled to match the Select component.
 */
export interface StyledDateInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const StyledDateInput = React.forwardRef<HTMLInputElement, StyledDateInputProps>(
  ({ className, error, type = 'date', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted [color-scheme:light] dark:[color-scheme:dark]',
          error && 'border-status-error-text focus:ring-status-error-text',
          className,
        )}
        {...props}
      />
    );
  },
);
StyledDateInput.displayName = 'StyledDateInput';

export { StyledSelect, StyledDateInput };
