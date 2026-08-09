import { getDb, isDbConnected } from '@/db';
import { trips, tripClosures, vehicleAllocations, vehicleInspections } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database,
  Clock,
  User,
  MapPin,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { statusConfig } from '@/lib/request-status';
import Link from 'next/link';
import { ClosureReviewActions } from './ClosureReviewActions';

interface ClosureTrip {
  id: string;
  status: string;
  returnedAt: Date | null;
  createdAt: Date;
  make: string | null;
  model: string | null;
  licenceNumber: string | null;
  requestReference: string | null;
  requestPurpose: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
  hasReturnInspection: boolean;
  hasClosureRecord: boolean;
}

const TRIP_STATUS_LABELS: Record<string, string> = {
  closure_review: statusConfig('closure_review').label,
};

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  closure_review: statusConfig('closure_review').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
};

async function fetchClosureReviewTrips(tenantId: string): Promise<ClosureTrip[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: trips.id,
      status: trips.status,
      returnedAt: trips.returnedAt,
      createdAt: trips.createdAt,
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
    .innerJoin(
      vehicles,
      and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)),
    )
    .innerJoin(
      transportRequests,
      and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, tenantId)),
    )
    .leftJoin(
      employees,
      and(
        eq(transportRequests.requesterEmployeeId, employees.id),
        eq(employees.tenantId, tenantId),
      ),
    )
    .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
    .where(and(eq(trips.tenantId, tenantId), eq(trips.status, 'closure_review')))
    .orderBy(desc(trips.returnedAt));

  const tripIds = rows.map((row) => row.id);
  const driverIds = Array.from(
    new Set(rows.map((row) => row.driverEmployeeId).filter((id): id is string => Boolean(id))),
  );

  const [inspRows, closureRows, driverRows] = await Promise.all([
    tripIds.length
      ? db
          .select({ tripId: vehicleInspections.tripId })
          .from(vehicleInspections)
          .where(and(
            eq(vehicleInspections.tenantId, tenantId),
            inArray(vehicleInspections.tripId, tripIds),
            eq(vehicleInspections.type, 'return'),
            inArray(vehicleInspections.status, ['completed', 'failed']),
          ))
      : Promise.resolve([] as Array<{ tripId: string | null }>),
    tripIds.length
      ? db
          .select({ tripId: tripClosures.tripId })
          .from(tripClosures)
          .where(inArray(tripClosures.tripId, tripIds))
      : Promise.resolve([] as Array<{ tripId: string }>),
    driverIds.length
      ? db
          .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, driverIds)))
      : Promise.resolve([] as Array<{ id: string; firstName: string | null; lastName: string | null }>),
  ]);

  const returnInspTripIds = new Set(inspRows.map((row) => row.tripId));
  const closureTripIds = new Set(closureRows.map((row) => row.tripId));
  const driverMap = new Map(driverRows.map((driver) => [driver.id, driver]));

  return rows.map((row) => {
    const driver = row.driverEmployeeId ? driverMap.get(row.driverEmployeeId) : null;
    return {
      id: row.id,
      status: row.status,
      returnedAt: row.returnedAt,
      createdAt: row.createdAt,
      make: row.make,
      model: row.model,
      licenceNumber: row.licenceNumber,
      requestReference: row.requestReference,
      requestPurpose: row.requestPurpose,
      requesterFirstName: row.requesterFirstName,
      requesterLastName: row.requesterLastName,
      driverFirstName: driver?.firstName ?? null,
      driverLastName: driver?.lastName ?? null,
      hasReturnInspection: returnInspTripIds.has(row.id),
      hasClosureRecord: closureTripIds.has(row.id),
    };
  });
}

export default async function ClosureReviewPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Closure Review' }]} />
        <PageHeader title="Trip Closure Review" description="Trips awaiting closure approval" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const canCloseTrips = resolveDashboardAccess(
    '/dashboard/trips/closure-review',
    roleNames,
  ).actions.includes('approve');

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Closure Review' }]} />
        <PageHeader title="Trip Closure Review" description="Trips awaiting closure approval" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let closureTrips: ClosureTrip[];
  try {
    closureTrips = await fetchClosureReviewTrips(session.tenantId);
  } catch (error) {
    console.error('Closure review query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Closure Review' }]} />
        <PageHeader title="Trip Closure Review" description="Trips awaiting closure approval" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Data" description="The database query failed." />
      </div>
    );
  }

  const closureReviewCount = closureTrips.length;
  const needInspection = closureTrips.filter((trip) => !trip.hasReturnInspection).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Trips', href: '/dashboard/trips' },
        { label: 'Closure Review' },
      ]} />
      <PageHeader
        title="Trip Closure Review"
        description={`${closureReviewCount} trip${closureReviewCount !== 1 ? 's' : ''} awaiting closure approval`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/trips">All Trips</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{closureReviewCount}</p>
            <p className="flex items-center justify-center gap-1 text-xs text-ink-500">
              <Clock className="h-3 w-3" /> Awaiting Closure
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{needInspection}</p>
            <p className="flex items-center justify-center gap-1 text-xs text-ink-500">
              <AlertTriangle className="h-3 w-3" /> Need Return Inspection
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-info-text">
              {closureReviewCount - needInspection}
            </p>
            <p className="flex items-center justify-center gap-1 text-xs text-ink-500">
              <CheckCircle2 className="h-3 w-3" /> Ready for Reconciliation
            </p>
          </CardContent>
        </Card>
      </div>

      {closureTrips.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-status-success-text" />}
          title="All Caught Up"
          description="No trips are waiting for closure review."
        />
      ) : (
        <div className="space-y-3">
          {closureTrips.map((trip) => {
            const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'pending';
            return (
              <article
                key={trip.id}
                className="rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/dashboard/trips/${trip.id}`} className="min-w-0 flex-1 rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                        <Clock className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-[650] text-ink-950">{trip.make} {trip.model}</p>
                          <span className="text-xs tabular-nums text-ink-500">{trip.licenceNumber}</span>
                          <StatusBadge status={variant} label={TRIP_STATUS_LABELS[trip.status] ?? trip.status} />
                          {!trip.hasReturnInspection && <Badge variant="emergency" size="sm">Missing Inspection</Badge>}
                          {trip.hasClosureRecord && <Badge variant="info" size="sm">Closure Recorded</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                          {trip.requestReference && (
                            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{trip.requestReference}</span>
                          )}
                          {trip.driverFirstName && (
                            <span className="flex items-center gap-1"><User className="h-3 w-3" />Driver: {trip.driverFirstName} {trip.driverLastName}</span>
                          )}
                          {trip.requesterFirstName && (
                            <span className="flex items-center gap-1"><User className="h-3 w-3" />Requester: {trip.requesterFirstName} {trip.requesterLastName}</span>
                          )}
                          {trip.returnedAt && <span className="tabular-nums">Returned {formatDateTime(trip.returnedAt)}</span>}
                          {trip.requestPurpose && (
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{trip.requestPurpose}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                    {canCloseTrips && (
                      <ClosureReviewActions
                        tripId={trip.id}
                        tripStatus={trip.status}
                        hasReturnInspection={trip.hasReturnInspection}
                      />
                    )}
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/dashboard/trips/${trip.id}`}>
                        Review <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
