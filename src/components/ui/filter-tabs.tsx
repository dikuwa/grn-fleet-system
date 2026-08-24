'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FilterTabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

const filterTabClassName =
  'focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-input)] border px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none';

const filterTabStateClassName = (active: boolean) =>
  active
    ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-700'
    : 'border-border bg-surface text-ink-600 hover:bg-muted hover:text-ink-950';

export function FilterTabs<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: Array<FilterTabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex max-w-full flex-wrap items-center justify-start gap-2', className)}
      role="group"
      aria-label={label}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(item.value)}
            className={cn(filterTabClassName, filterTabStateClassName(active))}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                  active
                    ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-700'
                    : 'bg-muted text-ink-500',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: Array<FilterTabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border bg-muted/70 inline-flex max-w-full flex-wrap items-center gap-1 rounded-[var(--radius-card)] border p-1',
        className,
      )}
      role="group"
      aria-label={label}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'focus-ring text-ink-600 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-input)] border border-transparent px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none',
              active
                ? 'border-border bg-surface text-ink-950 shadow-sm'
                : 'hover:bg-surface/70 hover:text-ink-950',
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' ? (
              <span className="text-ink-500 text-[10px] tabular-nums">({item.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
