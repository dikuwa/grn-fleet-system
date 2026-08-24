import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FilterTabLinkItem {
  href: string;
  label: string;
  active: boolean;
  icon?: ReactNode;
  count?: number;
}

export function FilterTabLinks({
  items,
  label,
  className,
}: {
  items: FilterTabLinkItem[];
  label: string;
  className?: string;
}) {
  return (
    <nav
      className={cn('flex max-w-full flex-wrap items-center justify-start gap-2', className)}
      aria-label={label}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-input)] border px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none',
            item.active
              ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-700'
              : 'border-border bg-surface text-ink-600 hover:bg-muted hover:text-ink-950',
          )}
        >
          {item.icon}
          <span>{item.label}</span>
          {typeof item.count === 'number' ? (
            <span className="text-ink-500 text-[10px] tabular-nums">({item.count})</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
