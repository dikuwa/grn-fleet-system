import { getDb, isDbConnected } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees, driverProfiles } from '@/db/schema/people';
import { eq, desc, asc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Search, ChevronRight, ChevronLeft, Download } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import {
  canPerformDashboardAction,
  resolveDashboardAccess,
  SystemRoles,
} from '@/lib/dashboard-access';
import { statusConfig, TRIP_STATUS_GROUPS } from '@/lib/request-status';
import { StyledSelect } from '@/components/ui/styled-select';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, sumGroupedCounts } from '@/lib/statistics';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

// Trip status labels derived from request-status utility
const TRIP_STATUS_LABELS: Record<string, string> = {
  pending: statusConfig('pending').label,
  in_progress: statusConfig('in_progress').label,
  return_due: statusConfig('return_due').label,
  return_inspection: statusConfig('return_inspection').label,
  closure_review: statusConfig('closure_review').label,
  closed: statusConfig('closed').label,
};

async function fetchTrips(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: 'self' | 'assigned' | 'related' | 'tenant' | 'platform',
  roleNames: string[],
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = normalizeOptionalFilter(sp.search);
  const status = normalizeOptionalFilter(sp.status);
  const driverId = normalizeOptionalFilter(sp.driverId);

  const baseConditions: SQL[] = [eq(trips.tenantId, tenantId)];
  if (recordScope === 'assigned' && roleNames.includes(SystemRoles.DRIVER)) {
    const [driverEmployee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
      .limit(1);
    if (!driverEmployee)
      return {
        rows: [],
        totalCount: 0,
        totalPages: 0,
        page,
        metrics: { total: 0, active: 0, returnDue: 0, closed: 0 },
        filters: { search, status, driverId },
        driverList: [],
      };
    baseConditions.push(eq(vehicleAllocations.driverEmployeeId, driverEmployee.id));
  } else if (recordScope === 'related' && roleNames.includes(SystemRoles.MAINTENANCE)) {
    baseConditions.push(sql<boolean>`EXISTS (
      SELECT 1 FROM maintenance_events me WHERE me.vehicle_id = ${trips.vehicleId}
      UNION
      SELECT 1 FROM vehicle_defects vd WHERE vd.vehicle_id = ${trips.vehicleId}
    )`);
  } else if (recordScope === 'related') {
    baseConditions.push(sql<boolean>`EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.trip_id = ${trips.id} AND vi.inspector_user_id = ${userId}
    )`);
  }
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (status) {
    conditions.push(eq(trips.status, status));
  }
  if (driverId) {
    conditions.push(eq(vehicleAllocations.driverEmployeeId, driverId));
  }
  if (search) {
    conditions.push(
      or(
        like(vehicles.licenceNumber, `%${search}%`),
        like(vehicles.vehicleRegisterNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch list of available drivers for the filter dropdown
  const driverList = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
    })
    .from(employees)
    .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .where(
      and(
        eq(employees.tenantId, tenantId),
        eq(employees.isDriver, true),
        eq(employees.employmentStatus, 'active'),
      ),
    )
    .orderBy(asc(employees.lastName));

  const [rows, totalResult, statusCounts] = await Promise.all([
    db
      .select({
        id: trips.id,
        status: trips.status,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
        closedAt: trips.closedAt,
        createdAt: trips.createdAt,
        vehicleId: trips.vehicleId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
      })
      .from(trips)
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(where)
      .orderBy(desc(trips.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(trips)
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(where),
    db
      .select({ key: trips.status, count: sql<number>`count(*)` })
      .from(trips)
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(baseWhere)
      .groupBy(trips.status),
  ]);

  // Build a driver name lookup map from the driver list
  const driverNameMap = new Map(driverList.map((d) => [d.id, `${d.firstName} ${d.lastName}`]));

  // Enrich rows with driver name from lookup
  const enrichedRows = rows.map((row) => ({
    ...row,
    driverName: row.driverEmployeeId ? (driverNameMap.get(row.driverEmployeeId) ?? null) : null,
  }));

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const counts = groupedCountMap(statusCounts);

  return {
    rows: enrichedRows,
    totalCount,
    totalPages,
    page,
    metrics: {
      total: [...counts.values()].reduce((total, count) => total + count, 0),
      active: sumGroupedCounts(counts, TRIP_STATUS_GROUPS.active),
      returnDue: sumGroupedCounts(counts, TRIP_STATUS_GROUPS.returnDue),
      closed: sumGroupedCounts(counts, TRIP_STATUS_GROUPS.closed),
    },
    filters: { search, status, driverId },
    driverList,
  };
}

export default async function TripsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view trips."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set DATABASE_URL and run migrations."
        />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/trips', roleNames);
  let result: Awaited<ReturnType<typeof fetchTrips>>;
  try {
    result = await fetchTrips(
      sp,
      session.tenantId,
      session.user.id,
      access.recordScope || 'self',
      roleNames,
    );
  } catch (error) {
    console.error('Trips query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Trips"
          description="The database query failed. Run migrations first."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
      <PageHeader
        title={
          roleNames.includes(SystemRoles.DRIVER)
            ? 'Assigned Trips'
            : roleNames.includes(SystemRoles.TENANT_ADMIN)
              ? 'Trip Monitoring'
              : 'Trips'
        }
        description={
          access.actions.includes('update')
            ? 'Manage operational trips and vehicle assignments'
            : 'Read-only trips within your permitted scope'
        }
      >
        {canPerformDashboardAction('/dashboard/trips', roleNames, 'export') && (
          <Button variant="tertiary" size="sm" asChild>
            <a href="/api/reports?type=trips&export=csv&period=90d">
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
        )}
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{result.metrics.total}</p>
            <p className="text-ink-500 text-xs">Total Trips</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-info-text text-2xl font-[650] tabular-nums">
              {result.metrics.active}
            </p>
            <p className="text-ink-500 text-xs">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-emergency-text text-2xl font-[650] tabular-nums">
              {result.metrics.returnDue}
            </p>
            <p className="text-ink-500 text-xs">Return Due</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-success-text text-2xl font-[650] tabular-nums">
              {result.metrics.closed}
            </p>
            <p className="text-ink-500 text-xs">Closed</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Status Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'All', value: '', statusCode: null },
          { label: 'Active', value: 'in_progress', statusCode: 'in_progress' },
          { label: 'Return Due', value: 'return_due', statusCode: 'return_due' },
          {
            label: 'Return Inspection',
            value: 'return_inspection',
            statusCode: 'return_inspection',
          },
          { label: 'Closure Review', value: 'closure_review', statusCode: 'closure_review' },
          { label: 'Closed', value: 'closed', statusCode: 'closed' },
          { label: 'Pending', value: 'pending', statusCode: 'pending' },
        ].map((f) => {
          const isActive = (result.filters.status ?? '') === f.value;
          return (
            <Link
              key={f.value}
              href={buildFilterUrl('/dashboard/trips', sp, { status: f.value, page: undefined })}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-surface text-ink-600 hover:bg-ink-50 border-border border'
              }`}
            >
              {f.statusCode ? (
                <StatusBadgeWithIcon
                  status={f.statusCode}
                  iconOnly
                  iconSize={14}
                  className="[&_svg]:text-current"
                />
              ) : null}
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/trips" isFiltered={hasActiveFilters(result.filters)}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <div className="relative">
                <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  name="search"
                  defaultValue={result.filters.search ?? ''}
                  placeholder="GRN number, make, model..."
                  className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-200 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="status"
                defaultValue={result.filters.status ?? ''}
                placeholder="All Statuses"
              >
                {Object.entries(TRIP_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="w-[220px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Driver</label>
              <StyledSelect
                name="driverId"
                defaultValue={result.filters.driverId ?? ''}
                placeholder="All Drivers"
              >
                {result.driverList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.firstName} {d.lastName} ({d.employeeNumber})
                  </option>
                ))}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Trip List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No trips found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No trips have been recorded yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((trip) => {
            const requesterName =
              trip.requesterFirstName && trip.requesterLastName
                ? `${trip.requesterFirstName} ${trip.requesterLastName}`
                : null;
            return (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
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
                          {trip.make} {trip.model}
                        </p>
                        <StatusBadgeWithIcon status={trip.status} />
                      </div>
                      <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="tabular-nums">{trip.licenceNumber}</span>
                        {trip.requestReference && <span>{trip.requestReference}</span>}
                        {requesterName && <span>Req: {requesterName}</span>}
                        {trip.driverName && <span>Driver: {trip.driverName}</span>}
                        <span className="tabular-nums">{formatDate(trip.createdAt)}</span>
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
            Page {result.page} of {result.totalPages} ({result.totalCount} trips)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/trips', sp, { page: String(result.page - 1) })}
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/trips', sp, { page: String(result.page + 1) })}
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
