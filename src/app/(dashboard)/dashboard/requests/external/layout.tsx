import Link from 'next/link';
import { Link2, UserRoundPlus } from 'lucide-react';

export default function ExternalRequestsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <nav aria-label="External request tools" className="flex flex-wrap gap-2 rounded-[8px] border border-border bg-surface p-2">
        <Link href="/dashboard/requests/external/new" className="inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-sm font-medium text-ink-700 transition hover:bg-muted hover:text-ink-950">
          <UserRoundPlus className="h-4 w-4" /> Assisted intake
        </Link>
        <Link href="/dashboard/requests/external/intake-links" className="inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-sm font-medium text-ink-700 transition hover:bg-muted hover:text-ink-950">
          <Link2 className="h-4 w-4" /> Secure public links
        </Link>
      </nav>
      {children}
    </div>
  );
}
