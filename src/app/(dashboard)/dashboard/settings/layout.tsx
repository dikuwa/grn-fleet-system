import Link from 'next/link';

export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <nav aria-label="Tenant settings" className="border-border flex flex-wrap gap-2 border-b pb-3">
        <Link
          href="/dashboard/settings"
          className="text-ink-700 hover:bg-muted hover:text-ink-950 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors"
        >
          Tenant Settings
        </Link>
        <Link
          href="/dashboard/settings/request-access"
          className="text-ink-700 hover:bg-muted hover:text-ink-950 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors"
        >
          Request Access
        </Link>
      </nav>
      {children}
    </div>
  );
}
