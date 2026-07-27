import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { tenants, transportRequests } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { secureHash } from '@/lib/secure-request';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function SecureRequestTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { tenantSlug, id } = await params;
  const { token } = await searchParams;
  if (!token) notFound();
  const db = getDb();
  const [record] = await db.select({
    tenantName: tenants.name,
    reference: transportRequests.reference,
    status: transportRequests.status,
    purpose: transportRequests.purpose,
    submittedAt: transportRequests.submittedAt,
    updatedAt: transportRequests.updatedAt,
  }).from(transportRequests).innerJoin(tenants, eq(tenants.id, transportRequests.tenantId))
    .where(and(
      eq(transportRequests.id, id),
      eq(tenants.slug, tenantSlug),
      eq(transportRequests.publicTrackingTokenHash, secureHash(token)),
    )).limit(1);
  if (!record) notFound();
  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface"><div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4"><Link href={`/request/${tenantSlug}`} className="text-sm font-semibold text-ink-950">GRN Fleet</Link><PublicThemeToggle /></div></header>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{record.tenantName}</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-950">Request status</h1>
        <Card className="mt-6"><CardContent className="space-y-5 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-ink-500">Reference</p><p className="font-semibold text-ink-950">{record.reference}</p></div><StatusBadge status={record.status === 'rejected' ? 'error' : record.status === 'approved' ? 'success' : 'pending'} label={record.status.replaceAll('_', ' ')} /></div>
          <div><p className="text-xs text-ink-500">Purpose</p><p className="mt-1 text-sm text-ink-800">{record.purpose}</p></div>
          <div className="grid gap-3 border-t border-border pt-4 text-xs text-ink-500 sm:grid-cols-2"><p>Submitted: {record.submittedAt?.toLocaleString('en-NA')}</p><p>Last updated: {record.updatedAt.toLocaleString('en-NA')}</p></div>
        </CardContent></Card>
        <p className="mt-5 text-xs text-ink-500">This tracking page intentionally shows limited information. It cannot access employee directories, vehicles, drivers, reports, or other requests.</p>
      </div>
    </main>
  );
}
