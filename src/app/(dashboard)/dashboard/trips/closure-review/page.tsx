import { getDb, isDbConnected } from '@/db';
import { trips, tripClosures, vehicleAllocations, vehicleInspections } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database, Clock, Truck, User, MapPin, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, FileText,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
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
  return_inspection: statusConfig('return_inspection').label,
  return_due: statusConfig('return_due').label,
};

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  closure_review: statusConfig('closure_review').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_inspection: statusConfig('return_inspection').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_due: statusConfig('return_due').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
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
      driverFirstName: employees.firstName,
      driverLastName: employees.lastName,
    })
    .from(trips)
    .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(
      and(
        eq(trips.tenantId, tenantId),
        // Only trips that need attention: closure_review, return_inspection, return_due
        eq(trips.status, 'closure_review'),
      ),
    )
    .orderBy(desc(trips.returnedAt));

  // Check which trips have return inspections and closure records
  const tripIds = rows.map((r) => r.id);
  let returnInspTripIds = new Set<string | null>();
  let closureTripIds = new Set<string>();

  if (tripIds.length > 0) {
    const [inspRows, closureRows] = await Promise.all([
      db
        .select({ tripId: vehicleInspections.tripId })
        .from(vehicleInspections)
        .where(
          and(
            inArray(vehicleInspections.tripId, tripIds),
            eq(vehicleInspections.type, 'return'),
          ),
        ),
      db
        .select({ tripId: tripClosures.tripId })
        .from(tripClosures)
        .where(inArray(tripClosures.tripId, tripIds)),
    ]);

    returnInspTripIds = new Set(inspRows.map((r) => r.tripId));
    closureTripIds = new Set(closureRows.map((r) => r.tripId));
  }

  return rows.map((row) => ({
    ...row,
    hasReturnInspection: returnInspTripIds.has(row.id),
    hasClosureRecord: closureTripIds.has(row.id),
  }));
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

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Closure Review' }]} />
        <PageHeader title="Trip Closure Review" description="Trips awaiting closure approval" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let trips: ClosureTrip[];
  try {
    trips = await fetchClosureReviewTrips(session.tenantId);
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

  const closureReviewCount = trips.length;
  const needInspection = trips.filter((t) => !t.hasReturnInspection).length;

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

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{closureReviewCount}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Awaiting Closure
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{needInspection}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Need Return Inspection
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-info-text">
              {closureReviewCount - needInspection}
            </p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Have Inspection, Need Closure
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Closure Review Trips List */}
      {trips.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-status-success-text" />}
          title="All Caught Up"
          description="No trips are waiting for closure review. All return inspections are being handled smoothly."
        />
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => {
            const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'pending';

            return (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
                className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
                      trip.status === 'closure_review'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-muted text-ink-500'
                    }`}>
                      {trip.status === 'closure_review' ? (
                        <Clock className="h-6 w-6" />
                      ) : (
                        <AlertTriangle className="h-6 w-6" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-[650] text-ink-950">
                          {trip.make} {trip.model}
                        </p>
                        <span className="text-xs text-ink-500 tabular-nums">{trip.licenceNumber}</span>
                        <StatusBadge status={variant} label={TRIP_STATUS_LABELS[trip.status] ?? trip.status} />
                        {!trip.hasReturnInspection && (
                          <Badge variant="emergency" size="sm">Missing Inspection</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        {trip.requestReference && (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {trip.requestReference}
                          </span>
                        )}
                        {trip.requesterFirstName && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {trip.requesterFirstName} {trip.requesterLastName}
                          </span>
                        )}
                        {trip.returnedAt && (
                          <span className="tabular-nums">
                            Returned {formatDateTime(trip.returnedAt)}
                          </span>
                        )}
                        {trip.requestPurpose && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {trip.requestPurpose}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <ClosureReviewActions
                      tripId={trip.id}
                      tripStatus={trip.status}
                      hasReturnInspection={trip.hasReturnInspection}
                    />
                    <ChevronRight className="h-4 w-4 text-ink-300" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
