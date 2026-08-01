import { getDb, isDbConnected } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Search, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { canPerformDashboardAction } from '@/lib/dashboard-access';
import { StyledSelect } from '@/components/ui/styled-select';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, sumGroupedCounts } from '@/lib/statistics';
import Link from 'next/link';

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

  if (state) {
    conditions.push(eq(vehicleAllocations.state, state));
  }
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
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]}
        />
        <PageHeader
          title="Vehicle Allocations"
          description="Manage vehicle assignments to transport requests"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view allocations."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]}
        />
        <PageHeader
          title="Vehicle Allocations"
          description="Manage vehicle assignments to transport requests"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set DATABASE_URL and run migrations."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchAllocations>>;
  const roleNames = await getSessionRoleNames(session);
  const canCreate = canPerformDashboardAction('/dashboard/allocations/new', roleNames, 'create');
  try {
    result = await fetchAllocations(sp, session.tenantId);
  } catch (error) {
    console.error('Allocations query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]}
        />
        <PageHeader
          title="Vehicle Allocations"
          description="Manage vehicle assignments to transport requests"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Allocations"
          description="The database query failed. Run migrations first."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
      <PageHeader
        title="Vehicle Allocations"
        description="Manage vehicle assignments to transport requests"
      >
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/allocations/new">
              <Plus className="h-4 w-4" /> New Allocation
            </Link>
          </Button>
        )}
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{result.metrics.active}</p>
            <p className="text-ink-500 text-xs">Active Allocations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
              {result.metrics.provisional}
            </p>
            <p className="text-ink-500 text-xs">Provisional</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-info-text text-2xl font-[650] tabular-nums">
              {result.metrics.confirmed}
            </p>
            <p className="text-ink-500 text-xs">Confirmed</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/allocations"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <div className="relative">
                <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  name="search"
                  defaultValue={result.filters.search ?? ''}
                  placeholder="GRN number, make, model, request..."
                  className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">State</label>
              <StyledSelect
                name="state"
                defaultValue={result.filters.state ?? ''}
                placeholder="All States"
              >
                {Object.entries(ALLOCATION_STATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Allocation List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No allocations found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No vehicle allocations have been made yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((alloc) => {
            const requesterName =
              alloc.requesterFirstName && alloc.requesterLastName
                ? `${alloc.requesterFirstName} ${alloc.requesterLastName}`
                : null;
            return (
              <Link
                key={alloc.id}
                href={`/dashboard/allocations/${alloc.id}`}
                className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="bg-brand-50 text-brand-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px]">
                      <Truck className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-ink-950 text-sm font-[650]">
                          {alloc.make} {alloc.model}
                        </p>
                        <StatusBadgeWithIcon status={alloc.state} />
                      </div>
                      <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="tabular-nums">{alloc.licenceNumber}</span>
                        {alloc.requestReference && <span>{alloc.requestReference}</span>}
                        {requesterName && <span>Requester: {requesterName}</span>}
                        <span className="tabular-nums">
                          {formatDate(alloc.startAt)} – {formatDate(alloc.endAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 h-4 w-4 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-ink-500 text-xs">
            Page {result.page} of {result.totalPages} ({result.totalCount} allocations)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/allocations', sp, {
                    page: String(result.page - 1),
                  })}
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/allocations', sp, {
                    page: String(result.page + 1),
                  })}
                >
                  Next <ChevronRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
