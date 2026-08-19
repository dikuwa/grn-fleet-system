'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard/setup', label: 'Initial Setup', exact: true },
  { href: '/dashboard/setup/operational', label: 'Operational Setup', exact: false },
] as const;

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-5 sm:space-y-6">
      <nav
        aria-label="Workspace setup sections"
        className="border-border bg-surface-0 flex w-full gap-1 overflow-x-auto rounded-[8px] border p-1"
      >
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'min-h-9 shrink-0 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'text-ink-500 hover:bg-surface-1 hover:text-ink-950',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
