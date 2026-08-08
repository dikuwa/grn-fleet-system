import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        aria-invalid={error || props['aria-invalid'] || undefined}
        className={cn(
          'flex h-10 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3 py-2 text-sm text-ink-950 shadow-none outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-500 hover:border-ink-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-500 disabled:opacity-70 motion-reduce:transition-none',
          error && 'border-status-error-text focus:border-status-error-text focus:ring-status-error-text/20',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        aria-invalid={error || props['aria-invalid'] || undefined}
        className={cn(
          'flex min-h-[88px] w-full resize-y rounded-[var(--radius-input)] border border-border bg-surface px-3 py-2 text-sm text-ink-950 shadow-none outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-500 hover:border-ink-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-500 disabled:opacity-70 motion-reduce:transition-none',
          error && 'border-status-error-text focus:border-status-error-text focus:ring-status-error-text/20',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn('block text-sm font-medium text-ink-700', className)}
        {...props}
      >
        {children}
        {required && (
          <span className="ml-0.5 text-status-error-text" aria-hidden="true">
            *
          </span>
        )}
      </label>
    );
  },
);
Label.displayName = 'Label';

export { Label };

interface FieldWrapperProps {
  label?: string;
  required?: boolean;
  error?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldWrapper({
  label,
  required,
  error,
  description,
  children,
  className,
}: FieldWrapperProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label required={required}>{label}</Label>}
      {description && <p className="text-xs leading-relaxed text-ink-500">{description}</p>}
      {children}
      {error && (
        <p className="text-xs font-medium text-status-error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface FormErrorProps {
  message?: string;
  errors?: Record<string, string[] | undefined>;
}

export function FormError({ message, errors }: FormErrorProps) {
  if (!message && !errors) return null;

  const allErrors = [
    ...(message ? [message] : []),
    ...Object.entries(errors || {})
      .filter(([, msgs]) => msgs && msgs.length > 0)
      .map(([field, msgs]) => `${field}: ${msgs?.join(', ')}`),
  ];

  if (allErrors.length === 0) return null;

  return (
    <div
      className="rounded-[var(--radius-input)] border border-status-error-text/20 bg-status-error-bg p-3"
      role="alert"
      aria-live="polite"
    >
      <ul className="list-inside list-disc space-y-1">
        {allErrors.map((err, i) => (
          <li key={i} className="text-xs text-status-error-text">
            {err}
          </li>
        ))}
      </ul>
    </div>
  );
}
