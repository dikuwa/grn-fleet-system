import { getDb, isDbConnected } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database, Gauge, Truck, User, Clock, MapPin, ChevronRight, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';
import { ActiveTripDuration } from './ActiveTripDuration';

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  pending: 'pending',
  in_progress: 'info',
  return_due: 'emergency',
  return_inspection: 'pending',
  closure_review: 'pending',
  closed: 'success',
};

async function fetchActiveTrips(tenantId: string) {
  const db = getDb();

  const activeTripRows = await db
    .select({
      id: trips.id,
      status: trips.status,
      startedAt: trips.startedAt,
      returnedAt: trips.returnedAt,
      createdAt: trips.createdAt,
      vehicleId: trips.vehicleId,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      requestReference: transportRequests.reference,
      requestPurpose: transportRequests.purpose,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
    })
    .from(trips)
    .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
    .where(
      and(
        eq(trips.tenantId, tenantId),
        ne(trips.status, 'closed'),
        ne(trips.status, 'pending'),
      ),
    )
    .orderBy(desc(trips.startedAt));

  // Summary counts
  const inProgressCount = activeTripRows.filter((t) => t.status === 'in_progress').length;
  const returnDueCount = activeTripRows.filter((t) => t.status === 'return_due').length;
  const returnInspCount = activeTripRows.filter((t) => t.status === 'return_inspection').length;
  const closureReviewCount = activeTripRows.filter((t) => t.status === 'closure_review').length;

  // Build a driver name lookup from active trip driver IDs
  const driverIds = [...new Set(activeTripRows.map((t) => t.driverEmployeeId).filter(Boolean))] as string[];
  const driverNameMap = new Map<string, string>();
  if (driverIds.length > 0) {
    const drivers = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(sql`${employees.id} IN (${sql.join(driverIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const d of drivers) {
      driverNameMap.set(d.id, `${d.firstName} ${d.lastName}`);
    }
  }

  // Enrich rows with driver name from lookup
  const enrichedTrips = activeTripRows.map((row) => ({
    ...row,
    driverName: row.driverEmployeeId ? (driverNameMap.get(row.driverEmployeeId) ?? null) : null,
  }));

  return {
    trips: enrichedTrips,
    totalCount: enrichedTrips.length,
    inProgressCount,
    returnDueCount,
    returnInspCount,
    closureReviewCount,
  };
}

export default async function ActiveTripsPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Active Trips' }]} />
        <PageHeader title="Active Trips" description="Trips currently on the road or awaiting closure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Active Trips' }]} />
        <PageHeader title="Active Trips" description="Trips currently on the road or awaiting closure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchActiveTrips>>;
  try {
    data = await fetchActiveTrips(session.tenantId);
  } catch (error) {
    console.error('Active trips query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Active Trips' }]} />
        <PageHeader title="Active Trips" description="Trips currently on the road or awaiting closure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Active Trips" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Active Trips' }]} />
      <PageHeader
        title="Active Trips"
        description={`${data.inProgressCount} on the road, ${data.returnDueCount} overdue, ${data.returnInspCount} awaiting inspection, ${data.closureReviewCount} in review`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/trips"><RefreshCw className="h-4 w-4" /> All Trips</Link>
        </Button>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-info-text">{data.inProgressCount}</p>
          <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><Gauge className="h-3 w-3" /> In Progress</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{data.returnDueCount}</p>
          <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" /> Return Due</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-pending-text">{data.returnInspCount}</p>
          <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> Return Inspection</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-ink-950">{data.closureReviewCount}</p>
          <p className="text-xs text-ink-500">Closure Review</p>
        </CardContent></Card>
      </div>

      {/* Active Trips List */}
      {data.trips.length === 0 ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          title="No Active Trips"
          description="All trips have been completed or closed."
        />
      ) : (
        <div className="space-y-3">
          {data.trips.map((trip) => {
            const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'info';
            const driverName = trip.driverName;

            return (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
                className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status indicator */}
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
                      trip.status === 'in_progress' ? 'bg-status-info-bg text-status-info-text' :
                      trip.status === 'return_due' ? 'bg-status-emergency-bg text-status-emergency-text' :
                      'bg-muted text-ink-500'
                    }`}>
                      {trip.status === 'in_progress' ? (
                        <Gauge className="h-6 w-6" />
                      ) : trip.status === 'return_due' ? (
                        <AlertTriangle className="h-6 w-6" />
                      ) : (
                        <Clock className="h-6 w-6" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-[650] text-ink-950">{trip.make} {trip.model}</p>
                        <StatusBadge status={variant} label={
                          trip.status === 'in_progress' ? 'In Progress' :
                          trip.status === 'return_due' ? 'Return Due' :
                          trip.status === 'return_inspection' ? 'Return Insp.' :
                          'Closure Review'
                        } />
                        {trip.startedAt && (
                          <ActiveTripDuration tripId={trip.id} startedAt={trip.startedAt.toISOString()} />
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums">{trip.licenceNumber}</span>
                        {driverName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{driverName}</span>}
                        {trip.requestReference && <span>{trip.requestReference}</span>}
                        {trip.requestPurpose && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{trip.requestPurpose}</span>}
                        {trip.startedAt && <span className="tabular-nums">Started {formatDateTime(trip.startedAt)}</span>}
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
    </div>
  );
}
