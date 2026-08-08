import Link from 'next/link';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents, tenants } from '@/db/schema';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { formatDateTime } from '@/lib/utils';
import { Search, ShieldCheck, X } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const query = q.trim();
  const db = getDb();
  const filter = query
    ? or(
        ilike(tenants.name, `%${query}%`),
        ilike(auditEvents.eventType, `%${query}%`),
        ilike(auditEvents.summary, `%${query}%`),
        ilike(auditEvents.sourceChannel, `%${query}%`),
      )
    : undefined;

  const rows = await db
    .select({
      id: auditEvents.id,
      tenantName: tenants.name,
      eventType: auditEvents.eventType,
      summary: auditEvents.summary,
      actorUserId: auditEvents.actorUserId,
      sourceChannel: auditEvents.sourceChannel,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .innerJoin(tenants, eq(auditEvents.tenantId, tenants.id))
    .where(filter ? and(filter) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Platform Audit' },
        ]}
      />
      <PageHeader
        title="Platform Audit"
        description="Cross-tenant platform activity and administrative events without exposing operational request contents."
      />

      <form className="border-border flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center" method="get">
        <div className="relative min-w-0 flex-1 sm:max-w-lg">
          <Search className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search tenant, event, summary or source..."
            className="pl-9"
            aria-label="Search platform audit events"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">Search</Button>
        {query && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/platform/audit"><X className="h-4 w-4" aria-hidden="true" />Clear</Link>
          </Button>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-500 text-xs">
          Showing {rows.length} most recent {query ? 'matching ' : ''}event{rows.length === 1 ? '' : 's'} (maximum 200)
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={query ? 'No matching platform audit events' : 'No platform audit events found'}
          description={query ? 'Try a broader search or clear the current search.' : 'Cross-tenant administrative activity will appear here.'}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          <div className="border-border bg-muted/40 text-ink-500 hidden grid-cols-[180px_minmax(0,1fr)_190px] gap-4 border-b px-5 py-3 text-xs font-medium md:grid">
            <span>Tenant / time</span><span>Event</span><span className="text-right">Type / source</span>
          </div>
          {rows.map((row) => (
            <article
              key={row.id}
              className="border-border grid gap-3 border-b px-4 py-4 last:border-b-0 sm:px-5 md:grid-cols-[180px_minmax(0,1fr)_190px] md:items-center"
            >
              <div>
                <p className="text-ink-950 text-sm font-medium">{row.tenantName}</p>
                <p className="text-ink-500 mt-0.5 text-xs">{formatDateTime(row.createdAt)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-ink-800 text-sm">{row.summary || row.eventType}</p>
                <p className="text-ink-500 mt-1 text-xs">Actor {row.actorUserId.slice(0, 12)}…</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <StatusBadgeWithIcon status={row.eventType} />
                <span className="text-ink-500 text-xs">{row.sourceChannel}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
