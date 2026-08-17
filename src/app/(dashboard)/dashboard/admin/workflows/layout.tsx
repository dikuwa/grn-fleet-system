'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GitBranch, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard/admin/workflows', label: 'Routing', icon: GitBranch, exact: true },
  {
    href: '/dashboard/admin/workflows/control',
    label: 'Drafts & Preview',
    icon: ShieldCheck,
    exact: false,
  },
] as const;

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-4">
      <nav
        aria-label="Workflow administration"
        className="border-border bg-surface flex w-full gap-1 overflow-x-auto rounded-[8px] border p-1"
      >
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'focus-ring flex min-h-10 shrink-0 items-center gap-2 rounded-[6px] px-3 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/20 dark:text-brand-200'
                  : 'text-ink-600 hover:bg-muted hover:text-ink-950',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
