import { getDb, isDbConnected } from '@/db';
import { trips } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
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

async function fetchTrips(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const status = sp.status?.trim();

  const conditions: SQL[] = [];

  if (status) {
    conditions.push(eq(trips.status, status));
  }
  if (search) {
    conditions.push(
      or(
        like(vehicles.grnNumber, `%${search}%`),
        like(vehicles.registrationNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
        grnNumber: vehicles.grnNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(trips)
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(trips.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(trips)
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  return {
    rows,
    totalCount,
    totalPages,
    page,
    filters: { search, status },
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
    result = await fetchTrips(sp);
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
      <PageHeader title="Trips" description="Manage operational trips and vehicle assignments" />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p><p className="text-xs text-ink-500">Total Trips</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{activeCount}</p><p className="text-xs text-ink-500">Active</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{returnDueCount}</p><p className="text-xs text-ink-500">Return Due</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{closedCount}</p><p className="text-xs text-ink-500">Closed</p></CardContent></Card>
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
                        <span className="tabular-nums">{trip.grnNumber}</span>
                        {trip.requestReference && <span>{trip.requestReference}</span>}
                        {requesterName && <span>Req: {requesterName}</span>}
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
