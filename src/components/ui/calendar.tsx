'use client';

import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        caption: 'flex justify-center relative items-center h-9',
        caption_label: 'text-sm font-medium text-ink-950',
        nav: 'flex items-center gap-1',
        nav_button: cn(
          'inline-flex items-center justify-center h-7 w-7 rounded-md',
          'text-ink-500 hover:text-ink-950 hover:bg-muted',
          'transition-colors',
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse',
        head_row: 'flex',
        head_cell: cn(
          'w-9 h-7 text-xs font-medium text-ink-500',
          'flex items-center justify-center',
        ),
        row: 'flex w-full mt-1',
        cell: cn(
          'relative p-0 text-center text-sm',
          'first:[&:has([aria-selected])]:rounded-l-md',
          'last:[&:has([aria-selected])]:rounded-r-md',
          '[&:has([aria-selected])]:bg-brand-50 dark:[&:has([aria-selected])]:bg-brand-950/30',
        ),
        day: cn(
          'h-9 w-9 rounded-md text-sm font-normal text-ink-700',
          'hover:bg-muted transition-colors',
          'aria-selected:bg-brand-700 aria-selected:text-white aria-selected:hover:bg-brand-800',
          'aria-selected:font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        ),
        day_today: 'font-semibold text-brand-700',
        day_outside: 'text-ink-300 opacity-50',
        day_disabled: 'text-ink-300 opacity-40',
        day_range_middle: '!rounded-none aria-selected:bg-brand-50 dark:aria-selected:bg-brand-950/30 aria-selected:text-ink-900 dark:aria-selected:text-ink-100',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === 'left' ? ChevronLeft : ChevronRight;
          return <Icon className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
