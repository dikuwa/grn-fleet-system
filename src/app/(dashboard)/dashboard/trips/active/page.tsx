import { getDb, isDbConnected } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database,
  Gauge,
  User,
  Clock,
  MapPin,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { statusConfig } from '@/lib/request-status';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActiveTripDuration } from './ActiveTripDuration';

const ACTIVE_TRIP_STATUSES = ['in_progress', 'return_due', 'return_inspection', 'closure_review'] as const;

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  pending: statusConfig('pending').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  in_progress: statusConfig('in_progress').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_due: statusConfig('return_due').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_inspection: statusConfig('return_inspection').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  closure_review: statusConfig('closure_review').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  closed: statusConfig('closed').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  in_progress: 'Monitor trip and wait for driver return',
  return_due: 'Follow up with driver and complete return',
  return_inspection: 'Complete the authorised return inspection',
  closure_review: 'Reconcile fuel, expenses and close the trip',
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
    .where(and(eq(trips.tenantId, tenantId), inArray(trips.status, [...ACTIVE_TRIP_STATUSES])))
    .orderBy(desc(trips.startedAt));

  const inProgressCount = activeTripRows.filter((trip) => trip.status === 'in_progress').length;
  const returnDueCount = activeTripRows.filter((trip) => trip.status === 'return_due').length;
  const returnInspCount = activeTripRows.filter((trip) => trip.status === 'return_inspection').length;
  const closureReviewCount = activeTripRows.filter((trip) => trip.status === 'closure_review').length;

  const driverIds = [...new Set(activeTripRows.map((trip) => trip.driverEmployeeId).filter(Boolean))] as string[];
  const driverNameMap = new Map<string, string>();
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          sql`${employees.id} IN (${sql.join(driverIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    for (const driver of drivers) driverNameMap.set(driver.id, `${driver.firstName} ${driver.lastName}`);
  }

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

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/trips/active', roleNames);
  if (!access.allowed || !access.actions.includes('view')) notFound();

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

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{data.inProgressCount}</p><p className="flex items-center justify-center gap-1 text-xs text-ink-500"><Gauge className="h-3 w-3" /> In Progress</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{data.returnDueCount}</p><p className="flex items-center justify-center gap-1 text-xs text-ink-500"><AlertTriangle className="h-3 w-3" /> Return Due</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-pending-text">{data.returnInspCount}</p><p className="flex items-center justify-center gap-1 text-xs text-ink-500"><Clock className="h-3 w-3" /> Return Inspection</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{data.closureReviewCount}</p><p className="text-xs text-ink-500">Closure Review</p></CardContent></Card>
      </div>

      {data.trips.length === 0 ? (
        <EmptyState icon={<Gauge className="h-8 w-8" />} title="No Active Trips" description="All trips have been completed or closed." />
      ) : (
        <div className="space-y-3">
          {data.trips.map((trip) => {
            const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'info';
            const driverName = trip.driverName;
            const nextAction = NEXT_ACTION_LABELS[trip.status] ?? 'Open trip details';

            return (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
                data-testid="active-trip-card"
                className="focus-ring block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm motion-reduce:transition-none"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${trip.status === 'in_progress' ? 'bg-status-info-bg text-status-info-text' : trip.status === 'return_due' ? 'bg-status-emergency-bg text-status-emergency-text' : 'bg-muted text-ink-500'}`}>
                      {trip.status === 'in_progress' ? <Gauge className="h-6 w-6" /> : trip.status === 'return_due' ? <AlertTriangle className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">{trip.make} {trip.model}</p>
                        <StatusBadge status={variant} label={statusConfig(trip.status).label} />
                        {trip.startedAt && <ActiveTripDuration tripId={trip.id} startedAt={trip.startedAt.toISOString()} />}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums">{trip.licenceNumber}</span>
                        {driverName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{driverName}</span>}
                        {trip.requestReference && <span>{trip.requestReference}</span>}
                        {trip.requestPurpose && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{trip.requestPurpose}</span>}
                        {trip.startedAt && <span className="tabular-nums">Started {formatDateTime(trip.startedAt)}</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-600">
                        <ArrowRight className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                        Next: {nextAction}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-300" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
