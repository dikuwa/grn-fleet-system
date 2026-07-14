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
        className={cn(
          'flex h-10 w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
          error && 'border-status-error-text focus:ring-status-error-text',
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
        className={cn(
          'flex min-h-[80px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
          error && 'border-status-error-text focus:ring-status-error-text',
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
        className={cn(
          'block text-sm font-medium text-ink-700',
          className,
        )}
        {...props}
      >
        {children}
        {required && <span className="ml-0.5 text-status-error-text">*</span>}
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
  children: React.ReactNode;
  className?: string;
}

export function FieldWrapper({
  label,
  required,
  error,
  children,
  className,
}: FieldWrapperProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label required={required}>{label}</Label>
      )}
      {children}
      {error && (
        <p className="text-xs text-status-error-text">{error}</p>
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
    <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg p-3">
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
