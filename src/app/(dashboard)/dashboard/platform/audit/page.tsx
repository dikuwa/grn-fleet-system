import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents, tenants } from '@/db/schema';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { formatDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function PlatformAuditPage() {
  const db = getDb();
  const rows = await db.select({
    id: auditEvents.id,
    tenantName: tenants.name,
    eventType: auditEvents.eventType,
    summary: auditEvents.summary,
    actorUserId: auditEvents.actorUserId,
    sourceChannel: auditEvents.sourceChannel,
    createdAt: auditEvents.createdAt,
  }).from(auditEvents)
    .innerJoin(tenants, eq(auditEvents.tenantId, tenants.id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Platform', href: '/dashboard/platform' }, { label: 'Platform Audit' }]} />
      <PageHeader title="Platform Audit" description="Cross-tenant platform activity without operational request details" />
      <Card>
        <CardContent className="divide-y divide-border pt-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 py-4 sm:grid-cols-[160px_1fr_180px] sm:items-center">
              <div>
                <p className="text-sm font-medium text-ink-950">{row.tenantName}</p>
                <p className="text-xs text-ink-500">{formatDateTime(row.createdAt)}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-800">{row.summary || row.eventType}</p>
                <p className="text-xs text-ink-500">Actor {row.actorUserId.slice(0, 12)}…</p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <StatusBadgeWithIcon status={row.eventType} />
                <span className="text-xs text-ink-500">{row.sourceChannel}</span>
              </div>
            </div>
          ))}
          {!rows.length && <p className="py-10 text-center text-sm text-ink-500">No platform audit events found.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
