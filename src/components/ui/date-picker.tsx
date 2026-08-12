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
        <label className="text-ink-500 block text-xs font-medium">
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
              'border-border bg-surface flex h-10 w-full items-center justify-between rounded-[8px] border px-3 text-sm',
              'focus:ring-brand-600 focus:ring-2 focus:ring-offset-1 focus:outline-none',
              'disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
              'dark:focus:ring-offset-ink-950',
              !value && 'text-ink-400',
              error && 'border-status-error-text focus:ring-status-error-text',
            )}
            aria-label={label ? `${label} - select date` : 'Select date'}
          >
            <span>{displayValue || placeholder}</span>
            <CalendarDays className="text-ink-400 h-4 w-4 shrink-0" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className={cn(
              'border-border bg-surface z-50 max-w-[calc(100vw-2rem)] rounded-[10px] border p-0 shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[side=bottom]:slide-in-from-top-2',
            )}
          >
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              defaultMonth={selectedDate}
              initialFocus
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
            />
            <div className="border-border flex items-center gap-2 border-t p-2.5">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder="dd/mm/yyyy"
                inputMode="numeric"
                className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-9 min-w-0 flex-1 rounded-[7px] border px-3 text-sm focus:ring-2 focus:outline-none"
                aria-label="Type date in dd/mm/yyyy format"
              />
              {value ? (
                <button
                  type="button"
                  onClick={() => handleSelect(undefined)}
                  className="text-ink-500 hover:text-ink-900 hover:bg-muted focus:ring-brand-600 h-9 shrink-0 rounded-[7px] px-3 text-xs font-medium transition-colors focus:ring-2 focus:outline-none"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-status-error-text text-xs">{error}</p>}
    </div>
  );
}
