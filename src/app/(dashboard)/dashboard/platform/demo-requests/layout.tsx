import Link from 'next/link';

export default function DemoRequestsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <nav aria-label="Demo management" className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Link
          href="/dashboard/platform/demo-requests"
          className="rounded-[8px] px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-muted hover:text-ink-950"
        >
          Demo Requests
        </Link>
        <Link
          href="/dashboard/platform/demo-requests/live"
          className="rounded-[8px] px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-muted hover:text-ink-950"
        >
          Live Demo
        </Link>
      </nav>
      {children}
    </div>
  );
}
