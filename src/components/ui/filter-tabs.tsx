'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FilterTabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

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
    <div className={cn('-mx-1 max-w-full scrollbar-thin overflow-x-auto px-1 pb-2', className)}>
      <div className="flex min-w-max gap-1.5" role="tablist" aria-label={label}>
        {items.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onValueChange(item.value)}
              className={cn(
                'focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none',
                active
                  ? 'border-brand-800 bg-brand-800 dark:border-brand-600 dark:bg-brand-600 text-white'
                  : 'border-border bg-surface text-ink-700 hover:bg-muted hover:text-ink-950',
              )}
            >
              {item.icon}
              <span>{item.label}</span>
              {typeof item.count === 'number' ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                    active ? 'bg-white/15 text-white' : 'bg-muted text-ink-500',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
