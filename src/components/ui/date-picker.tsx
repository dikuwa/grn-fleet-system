'use client';

import * as React from 'react';
import { format, parse, isValid } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { Calendar } from './calendar';

interface DatePickerProps {
  /** ISO date string (YYYY-MM-DD) */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  className?: string;
}

/**
 * DatePicker — calendar popover date selector using Radix Popover + react-day-picker.
 * Displays dates in dd/MM/yyyy format, stores as ISO (YYYY-MM-DD).
 */
export function DatePicker({
  value,
  onChange,
  label,
  required,
  min,
  max,
  disabled,
  placeholder = 'Select date...',
  error,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const d = new Date(value + 'T00:00:00');
    return isValid(d) ? d : undefined;
  }, [value]);

  const displayValue = React.useMemo(() => {
    if (!selectedDate) return '';
    try {
      return format(selectedDate, 'dd/MM/yyyy');
    } catch {
      return value || '';
    }
  }, [selectedDate, value]);

  const handleSelect = (date: Date | undefined) => {
    if (date && isValid(date)) {
      onChange(format(date, 'yyyy-MM-dd'));
    } else {
      onChange('');
    }
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputValue(raw);

    if (raw.length === 10) {
      const parsed = parse(raw, 'dd/MM/yyyy', new Date());
      if (isValid(parsed)) {
        onChange(format(parsed, 'yyyy-MM-dd'));
      }
    } else if (raw.length === 0) {
      onChange('');
    }
  };

  const minDate = min ? new Date(min + 'T00:00:00') : undefined;
  const maxDate = max ? new Date(max + 'T00:00:00') : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label className="block text-xs font-medium text-ink-500">
          {label}
          {required && <span className="text-status-error-text ml-0.5">*</span>}
        </label>
      )}
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setInputValue(displayValue);
        }}
      >
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-[8px] border border-border bg-surface px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-1',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
              'dark:focus:ring-offset-ink-950',
              !value && 'text-ink-400',
              error && 'border-status-error-text focus:ring-status-error-text',
            )}
            aria-label={label ? `${label} - select date` : 'Select date'}
          >
            <span>{displayValue || placeholder}</span>
            <CalendarDays className="h-4 w-4 shrink-0 text-ink-400" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className={cn(
              'z-50 rounded-[10px] border border-border bg-surface p-0 shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[side=bottom]:slide-in-from-top-2',
            )}
          >
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              initialFocus
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
            />
            <div className="border-t border-border p-2">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder="dd/mm/yyyy"
                className="h-8 w-full rounded-[6px] border border-border bg-surface px-2 text-xs text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                aria-label="Type date in dd/mm/yyyy format"
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-xs text-status-error-text">{error}</p>}
    </div>
  );
}
