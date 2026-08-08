import Link from 'next/link';
import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { canPerformDashboardAction } from '@/lib/dashboard-access';
import { StyledSelect } from '@/components/ui/styled-select';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, sumGroupedCounts } from '@/lib/statistics';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const ALLOCATION_STATE_LABELS: Record<string, string> = {
  provisional: 'Provisional',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  released: 'Released',
};

async function fetchAllocations(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = normalizeOptionalFilter(sp.search);
  const state = normalizeOptionalFilter(sp.state);

  const baseConditions: SQL[] = [eq(transportRequests.tenantId, tenantId)];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (state) conditions.push(eq(vehicleAllocations.state, state));
  if (search) {
    conditions.push(
      or(
        like(vehicles.licenceNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
        like(vehicles.model, `%${search}%`),
        like(transportRequests.reference, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, totalResult, stateCounts] = await Promise.all([
    db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        recommendationScore: vehicleAllocations.recommendationScore,
        overrideReason: vehicleAllocations.overrideReason,
        createdAt: vehicleAllocations.createdAt,
        vehicleId: vehicleAllocations.vehicleId,
        requestId: vehicleAllocations.requestId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(vehicleAllocations)
      .leftJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(vehicleAllocations.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleAllocations)
      .leftJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(where),
    db
      .select({ key: vehicleAllocations.state, count: sql<number>`count(*)` })
      .from(vehicleAllocations)
      .leftJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(baseWhere)
      .groupBy(vehicleAllocations.state),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const counts = groupedCountMap(stateCounts);
  return {
    rows,
    totalCount,
    totalPages,
    page,
    metrics: {
      active: sumGroupedCounts(counts, ['provisional', 'confirmed']),
      provisional: counts.get('provisional') ?? 0,
      confirmed: counts.get('confirmed') ?? 0,
    },
    filters: { search, state },
  };
}

export default async function AllocationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
        <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view allocations." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
        <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set DATABASE_URL and run migrations." />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const canCreate = canPerformDashboardAction('/dashboard/allocations/new', roleNames, 'create');
  let result: Awaited<ReturnType<typeof fetchAllocations>>;
  try {
    result = await fetchAllocations(sp, session.tenantId);
  } catch (error) {
    console.error('Allocations query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
        <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Allocations" description="The database query failed. Run migrations first." />
      </div>
    );
  }

  const metrics = [
    { label: 'Active Allocations', value: result.metrics.active, className: 'text-ink-950' },
    { label: 'Provisional', value: result.metrics.provisional, className: 'text-status-pending-text' },
    { label: 'Confirmed', value: result.metrics.confirmed, className: 'text-status-info-text' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
      <PageHeader title="Vehicle Allocations" description="Assign vehicles to approved transport requests and monitor allocation state">
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/allocations/new"><Plus className="h-4 w-4" aria-hidden="true" /> New Allocation</Link>
          </Button>
        )}
      </PageHeader>

      <section aria-label="Allocation summary" className="border-border grid grid-cols-1 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-4 sm:px-5">
            <p className={`text-2xl font-semibold tabular-nums ${metric.className}`}>{metric.value}</p>
            <p className="text-ink-500 mt-0.5 text-xs">{metric.label}</p>
          </div>
        ))}
      </section>

      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/allocations" isFiltered={hasActiveFilters(result.filters)}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <LiveSearchInput name="search" defaultValue={result.filters.search ?? ''} placeholder="GRN number, make, model, request…" />
            </div>
            <div className="w-full sm:w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">State</label>
              <StyledSelect name="state" defaultValue={result.filters.state ?? ''} placeholder="All States">
                {Object.entries(ALLOCATION_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No allocations found"
          description={hasActiveFilters(result.filters) ? 'No matching records found. Clear filters to view all records.' : 'No vehicle allocations have been made yet.'}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((allocation) => {
            const requesterName = allocation.requesterFirstName && allocation.requesterLastName ? `${allocation.requesterFirstName} ${allocation.requesterLastName}` : null;
            return (
              <Link key={allocation.id} href={`/dashboard/allocations/${allocation.id}`} className="focus-ring border-border group block border-b p-4 transition-colors last:border-b-0 hover:bg-muted/40 motion-reduce:transition-none sm:p-5">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="bg-brand-50 text-brand-700 hidden h-10 w-10 shrink-0 items-center justify-center rounded-[8px] sm:flex"><Truck className="h-5 w-5" aria-hidden="true" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-ink-950 text-sm font-semibold">{allocation.make} {allocation.model}</p><StatusBadgeWithIcon status={allocation.state} /></div>
                    <div className="text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="tabular-nums">{allocation.licenceNumber}</span>
                      {allocation.requestReference && <span>{allocation.requestReference}</span>}
                      {requesterName && <span>Requester: {requesterName}</span>}
                      <span className="tabular-nums">{formatDate(allocation.startAt)} – {formatDate(allocation.endAt)}</span>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages} ({result.totalCount} allocations)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/allocations', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/allocations', sp, { page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" aria-hidden="true" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
