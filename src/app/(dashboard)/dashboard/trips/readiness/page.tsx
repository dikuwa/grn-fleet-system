import { getDb, isDbConnected } from '@/db';
import {
  trips,
  vehicleAllocations,
  vehicleInspections,
  tripAuthorities,
} from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { workflowInstances } from '@/db/schema/workflows';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, ne, isNull, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  AlertTriangle,
  ClipboardCheck,
  User,
} from 'lucide-react';
import Link from 'next/link';

interface ReadinessGate {
  key: string;
  passed: boolean;
}

interface ReadinessInfo {
  status: 'ready' | 'blocked' | 'pending';
  blockingCount: number;
  pendingCount: number;
  passedCount: number;
  total: number;
  label: string;
  gates: ReadinessGate[];
}

interface TripRow {
  id: string;
  status: string;
  createdAt: Date | null;
  vehicleId: string | null;
  requestId: string | null;
  make: string | null;
  model: string | null;
  licenceNumber: string | null;
  requestReference: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
  driverEmployeeId: string | null;
  readiness: ReadinessInfo;
}

interface DashboardData {
  trips: TripRow[];
  summary: { total: number; ready: number; blocked: number; pending: number };
  topBlockers: { key: string; count: number }[];
}

const GATE_LABELS: Record<string, string> = {
  approvals: 'Approvals',
  vehicle_allocated: 'Vehicle',
  driver_allocated: 'Driver',
  no_blocking_defects: 'Defects',
  departure_inspection: 'Inspection',
  trip_authority: 'Authority',
  driver_accepted: 'Driver Accepted',
};

async function computeReadinessDashboard(tenantId: string): Promise<DashboardData> {
  const db = getDb();

  // Fetch all non-closed trips
  const tripRows = await db
    .select({
      id: trips.id,
      status: trips.status,
      createdAt: trips.createdAt,
      vehicleId: trips.vehicleId,
      requestId: trips.requestId,
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
    .where(
      and(
        eq(trips.tenantId, tenantId),
        ne(trips.status, 'closed'),
      ),
    )
    .orderBy(desc(trips.createdAt));

  // For each trip, compute readiness
  const enrichedTrips: TripRow[] = await Promise.all(
    tripRows.map(async (trip) => {
      if (!trip.requestId) {
        return {
          ...trip,
          readiness: { status: 'pending' as const, blockingCount: 0, pendingCount: 0, passedCount: 0, total: 7, label: 'No request linked', gates: [] },
        };
      }

      const [workflow] = await db
        .select({ status: workflowInstances.status })
        .from(workflowInstances)
        .where(eq(workflowInstances.requestId, trip.requestId))
        .limit(1);
      const requestApproved = workflow?.status === 'approved' || workflow?.status === 'completed';

      let blockingDefects = 0;
      if (trip.vehicleId) {
        const [defect] = await db
          .select({ count: sql<number>`count(*)` })
          .from(vehicleDefects)
          .where(
            and(
              eq(vehicleDefects.vehicleId, trip.vehicleId),
              isNull(vehicleDefects.resolvedAt),
              eq(vehicleDefects.isBlocking, true),
            ),
          );
        blockingDefects = Number(defect?.count || 0);
      }

      let depInspectionPassed = false;
      let depInspectionExists = false;
      if (trip.id) {
        const [dep] = await db
          .select({
            id: vehicleInspections.id,
            overallPass: vehicleInspections.overallPass,
          })
          .from(vehicleInspections)
          .where(
            and(
              eq(vehicleInspections.tripId, trip.id),
              eq(vehicleInspections.type, 'departure'),
            ),
          )
          .orderBy(desc(vehicleInspections.createdAt))
          .limit(1);
        depInspectionExists = !!dep;
        depInspectionPassed = dep?.overallPass === true;
      }

      const [authority] = await db
        .select({ id: tripAuthorities.id, status: tripAuthorities.status })
        .from(tripAuthorities)
        .where(and(eq(tripAuthorities.tripId, trip.id), eq(tripAuthorities.tenantId, tenantId)))
        .limit(1);
      const hasAuthority = !!authority;
      const driverAccepted = authority?.status === 'driver_accepted' ||
        authority?.status === 'awaiting_pre_trip_inspection' ||
        authority?.status === 'ready_for_departure';

      let driverIssue = false;
      if (trip.driverEmployeeId) {
        const [profile] = await db
          .select({
            driverStatus: driverProfiles.driverStatus,
            expiryDate: driverLicences.expiryDate,
            verificationStatus: driverLicences.verificationStatus,
          })
          .from(driverProfiles)
          .leftJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
          .where(eq(driverProfiles.employeeId, trip.driverEmployeeId))
          .orderBy(desc(driverLicences.expiryDate))
          .limit(1);
        if (!profile || profile.driverStatus !== 'authorised' || profile.verificationStatus !== 'verified') {
          driverIssue = true;
        }
        if (profile?.expiryDate && new Date(`${profile.expiryDate}T23:59:59Z`) <= new Date()) {
          driverIssue = true;
        }
      }

      const gates: ReadinessGate[] = [
        { key: 'approvals', passed: requestApproved },
        { key: 'vehicle_allocated', passed: !!trip.vehicleId },
        { key: 'driver_allocated', passed: !!trip.driverEmployeeId && !driverIssue },
        { key: 'no_blocking_defects', passed: blockingDefects === 0 },
        { key: 'departure_inspection', passed: depInspectionExists && depInspectionPassed },
        { key: 'trip_authority', passed: hasAuthority },
        { key: 'driver_accepted', passed: driverAccepted },
      ];

      const blockingCount = gates.filter((g) => !g.passed).length;
      const passedCount = gates.filter((g) => g.passed).length;
      const pendingCount = gates.length - passedCount - blockingCount;

      const status: 'ready' | 'blocked' | 'pending' =
        blockingCount === 0 && passedCount === gates.length ? 'ready' :
        blockingCount > 0 ? 'blocked' : 'pending';

      const label =
        status === 'ready' ? 'Ready for release' :
        status === 'blocked' ? `${blockingCount} gate${blockingCount > 1 ? 's' : ''} blocking` :
        `${pendingCount} pending`;

      return {
        ...trip,
        readiness: { status, blockingCount, pendingCount, passedCount, total: gates.length, label, gates },
      };
    }),
  );

  const readyCount = enrichedTrips.filter((t) => t.readiness.status === 'ready').length;
  const blockedCount = enrichedTrips.filter((t) => t.readiness.status === 'blocked').length;
  const pendingSortCount = enrichedTrips.filter((t) => t.readiness.status === 'pending').length;

  const gateCounts = new Map<string, number>();
  for (const t of enrichedTrips) {
    for (const g of t.readiness.gates) {
      if (!g.passed) {
        gateCounts.set(g.key, (gateCounts.get(g.key) || 0) + 1);
      }
    }
  }
  const topBlockers = [...gateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  return {
    trips: enrichedTrips,
    summary: { total: enrichedTrips.length, ready: readyCount, blocked: blockedCount, pending: pendingSortCount },
    topBlockers,
  };
}

export default async function ReadinessDashboardPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Release Readiness' }]} />
        <PageHeader title="Release Readiness" description="Overview of trip readiness status" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Release Readiness' }]} />
        <PageHeader title="Release Readiness" description="Overview of trip readiness status" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: DashboardData;
  try {
    data = await computeReadinessDashboard(session.tenantId);
  } catch (error) {
    console.error('Readiness dashboard compute failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Release Readiness' }]} />
        <PageHeader title="Release Readiness" description="Overview of trip readiness status" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load" description="The dashboard query failed. Ensure the database is seeded." />
      </div>
    );
  }

  const { trips, summary, topBlockers } = data;

  // Group trips by readiness
  const readyTrips = trips.filter((t) => t.readiness.status === 'ready');
  const blockedTrips = trips.filter((t) => t.readiness.status === 'blocked');
  const pendingTrips = trips.filter((t) => t.readiness.status === 'pending');

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Trips', href: '/dashboard/trips' },
        { label: 'Release Readiness' },
      ]} />
      <PageHeader
        title="Release Readiness"
        description={`${summary.total} active trips — ${summary.ready} ready, ${summary.blocked} blocked, ${summary.pending} pending`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/trips"><ChevronRight className="h-4 w-4" /> All Trips</Link>
        </Button>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{summary.total}</p>
            <p className="text-xs text-ink-500">Total Active Trips</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{summary.ready}</p>
            <p className="text-xs text-ink-500">Ready for Release</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{summary.blocked}</p>
            <p className="text-xs text-ink-500">Blocked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-pending-text">{summary.pending}</p>
            <p className="text-xs text-ink-500">In Progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Blocking Gates */}
      {topBlockers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-status-error-text" />
              Top Blocking Gates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topBlockers.map((b) => (
                <Badge key={b.key} variant="error" size="sm" className="text-xs">
                  {GATE_LABELS[b.key] || b.key}: {b.count} trip{b.count !== 1 ? 's' : ''}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Blocked Trips */}
      {blockedTrips.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-status-error-text">
            <XCircle className="h-4 w-4" /> Blocked ({blockedTrips.length})
          </h3>
          <div className="space-y-2">
            {blockedTrips.map((trip) => (
              <ReadinessTripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </div>
      )}

      {/* Pending Trips */}
      {pendingTrips.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-status-pending-text">
            <Clock className="h-4 w-4" /> Pending ({pendingTrips.length})
          </h3>
          <div className="space-y-2">
            {pendingTrips.map((trip) => (
              <ReadinessTripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </div>
      )}

      {/* Ready Trips */}
      {readyTrips.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-status-success-text">
            <CheckCircle2 className="h-4 w-4" /> Ready for Release ({readyTrips.length})
          </h3>
          <div className="space-y-2">
            {readyTrips.map((trip) => (
              <ReadinessTripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {trips.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No Active Trips"
          description="All trips are closed. Nothing to check for release readiness."
        />
      )}
    </div>
  );
}

function ReadinessTripCard({ trip }: { trip: TripRow }) {
  const r = trip.readiness;
  const requesterName = trip.requesterFirstName && trip.requesterLastName
    ? `${trip.requesterFirstName} ${trip.requesterLastName}`
    : null;

  return (
    <Link
      href={`/dashboard/trips/${trip.id}`}
      className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
            r.status === 'ready' ? 'bg-status-success-bg text-status-success-text' :
            r.status === 'blocked' ? 'bg-status-error-bg text-status-error-text' :
            'bg-status-pending-bg text-status-pending-text'
          }`}>
            {r.status === 'ready' ? <CheckCircle2 className="h-6 w-6" /> :
             r.status === 'blocked' ? <XCircle className="h-6 w-6" /> :
             <Clock className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-[650] text-ink-950">{trip.make} {trip.model}</p>
              <StatusBadge status={
                r.status === 'ready' ? 'success' : r.status === 'blocked' ? 'error' : 'pending'
              } label={r.label} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              <span className="tabular-nums">{trip.licenceNumber}</span>
              {trip.requestReference && <span>{trip.requestReference}</span>}
              {requesterName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{requesterName}</span>}
              <span className="tabular-nums">{trip.createdAt ? formatDate(trip.createdAt) : '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Progress indicator */}
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-ink-500">{r.passedCount}/{r.total}</span>
            <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div className="bg-status-success-text" style={{ width: `${(r.passedCount / r.total) * 100}%` }} />
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
        </div>
      </div>
    </Link>
  );
}
