import { getDb, isDbConnected } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees, driverProfiles } from '@/db/schema/people';
import { eq, desc, asc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Search, ChevronRight, ChevronLeft, Download } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const TRIP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  return_due: 'Return Due',
  return_inspection: 'Return Inspection',
  closure_review: 'Closure Review',
  closed: 'Closed',
};

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  pending: 'pending',
  in_progress: 'info',
  return_due: 'emergency',
  return_inspection: 'pending',
  closure_review: 'pending',
  closed: 'success',
};

async function fetchTrips(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const status = sp.status?.trim();
  const driverId = sp.driverId?.trim();

  const conditions: SQL[] = [eq(trips.tenantId, tenantId)];

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

  const [rows, totalResult] = await Promise.all([
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

  return {
    rows: enrichedRows,
    totalCount,
    totalPages,
    page,
    filters: { search, status, driverId },
    driverList,
  };
}

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function TripsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view trips." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set DATABASE_URL and run migrations." />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchTrips>>;
  try {
    result = await fetchTrips(sp, session.tenantId);
  } catch (error) {
    console.error('Trips query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
        <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Trips" description="The database query failed. Run migrations first." />
      </div>
    );
  }

  const activeCount = result.rows.filter((r) => r.status === 'in_progress' || r.status === 'pending').length;
  const returnDueCount = result.rows.filter((r) => r.status === 'return_due').length;
  const closedCount = result.rows.filter((r) => r.status === 'closed').length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips' }]} />
      <PageHeader title="Trips" description="Manage operational trips and vehicle assignments">
        <Button variant="tertiary" size="sm" asChild>
          <a href="/api/reports?type=trips&export=csv&period=90d">
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p><p className="text-xs text-ink-500">Total Trips</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{activeCount}</p><p className="text-xs text-ink-500">Active</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{returnDueCount}</p><p className="text-xs text-ink-500">Return Due</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{closedCount}</p><p className="text-xs text-ink-500">Closed</p></CardContent></Card>
      </div>

      {/* Quick Status Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'All', value: '' },
          { label: '🟢 Active', value: 'in_progress' },
          { label: '🔴 Return Due', value: 'return_due' },
          { label: '⏳ Return Inspection', value: 'return_inspection' },
          { label: '📋 Closure Review', value: 'closure_review' },
          { label: '✅ Closed', value: 'closed' },
          { label: '⏸️ Pending', value: 'pending' },
        ].map((f) => {
          const isActive = (result.filters.status ?? '') === f.value;
          return (
            <Link
              key={f.value}
              href={buildPageUrl('/dashboard/trips', { ...sp, status: f.value, page: '1' })}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-surface text-ink-600 hover:bg-ink-50 border border-border'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input name="search" defaultValue={result.filters.search ?? ''} placeholder="GRN number, make, model..." className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
              <select name="status" defaultValue={result.filters.status ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Statuses</option>
                {Object.entries(TRIP_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="w-[220px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Driver</label>
              <select name="driverId" defaultValue={result.filters.driverId ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Drivers</option>
                {result.driverList.map((d) => (
                  <option key={d.id} value={d.id}>{d.firstName} {d.lastName} ({d.employeeNumber})</option>
                ))}
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Trip List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<Truck className="h-8 w-8" />} title="No trips found" description={result.filters.search ? 'Try adjusting your search criteria.' : 'No trips have been recorded yet.'} />
      ) : (
        <div className="space-y-3">
          {result.rows.map((trip) => {
            const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'info';
            const requesterName = trip.requesterFirstName && trip.requesterLastName
              ? `${trip.requesterFirstName} ${trip.requesterLastName}`
              : null;
            return (
              <Link key={trip.id} href={`/dashboard/trips/${trip.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                      <Truck className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">{trip.make} {trip.model}</p>
                        <StatusBadge status={variant} label={TRIP_STATUS_LABELS[trip.status] ?? trip.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums">{trip.licenceNumber}</span>
                        {trip.requestReference && <span>{trip.requestReference}</span>}
                        {requesterName && <span>Req: {requesterName}</span>}
                        {trip.driverName && <span>Driver: {trip.driverName}</span>}
                        <span className="tabular-nums">{formatDate(trip.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages} ({result.totalCount} trips)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/trips', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/trips', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
