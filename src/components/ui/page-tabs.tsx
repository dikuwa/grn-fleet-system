'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageTabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function PageTabs<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
  panelId,
}: {
  items: Array<PageTabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  className?: string;
  panelId?: (value: T) => string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onValueChange(nextItem.value);
    buttons.current[nextIndex]?.focus();
  };

  return (
    <div
      className={cn(
        'border-border flex max-w-full flex-wrap items-center gap-x-1 border-b',
        className,
      )}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-controls={panelId?.(item.value)}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'focus-ring text-ink-500 hover:bg-muted/60 hover:text-ink-800 -mb-px inline-flex min-h-11 items-center gap-2 rounded-t-[var(--radius-input)] border-b-2 border-transparent px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none sm:px-4',
              active && 'border-brand-600 text-ink-950',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
