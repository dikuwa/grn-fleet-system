import Link from 'next/link';

export default async function PlatformTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-5">
      <nav
        aria-label="Tenant management"
        className="flex flex-wrap gap-2 border-b border-border pb-3 print:hidden"
      >
        <Link
          href={`/dashboard/platform/tenants/${id}`}
          className="rounded-[8px] px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-muted hover:text-ink-950"
        >
          Tenant Details
        </Link>
        <Link
          href={`/dashboard/platform/tenants/${id}/invitation`}
          className="rounded-[8px] px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-muted hover:text-ink-950"
        >
          Administrator Invitation
        </Link>
      </nav>
      {children}
    </div>
  );
}
