'use client';

import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn('relative p-3', className)}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'space-y-2',
        month_caption: 'flex h-9 items-center justify-start pr-20',
        caption_label: 'text-sm font-medium text-ink-950',
        nav: 'absolute right-3 top-3 flex h-9 items-center gap-1',
        button_previous: cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-transparent',
          'text-ink-500 hover:text-ink-950 hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
          'disabled:cursor-not-allowed disabled:opacity-40 transition-colors',
        ),
        button_next: cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-transparent',
          'text-ink-500 hover:text-ink-950 hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
          'disabled:cursor-not-allowed disabled:opacity-40 transition-colors',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'border-b border-border',
        weekday: 'h-8 w-9 text-center text-[11px] font-semibold text-ink-500',
        week: 'mt-1',
        day: cn(
          'relative h-9 w-9 p-0 text-center text-sm',
          '[&[data-selected]>button]:bg-brand-700 [&[data-selected]>button]:font-semibold',
          '[&[data-selected]>button]:text-white [&[data-selected]>button:hover]:bg-brand-800',
          'dark:[&[data-selected]>button]:bg-brand-600 dark:[&[data-selected]>button:hover]:bg-brand-600',
        ),
        day_button: cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-[7px] text-sm font-normal text-ink-700',
          'hover:bg-muted transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        ),
        today: '[&>button]:font-semibold [&>button]:text-brand-700 dark:[&>button]:text-brand-600',
        outside: '[&>button]:text-ink-300 [&>button]:opacity-60',
        disabled: '[&>button]:cursor-not-allowed [&>button]:text-ink-300 [&>button]:opacity-40',
        range_middle:
          '[&>button]:rounded-none [&>button]:bg-brand-50 [&>button]:text-ink-900 dark:[&>button]:bg-brand-950/30 dark:[&>button]:text-ink-100',
        hidden: 'invisible',
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
