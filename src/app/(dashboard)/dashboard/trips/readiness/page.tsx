import { getDb, isDbConnected } from '@/db';
import { trips, vehicleAllocations, vehicleInspections, tripAuthorities } from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  AlertTriangle,
  ClipboardCheck,
  User,
  CircleDot,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import Link from 'next/link';

type GateStatus = 'pass' | 'blocking' | 'pending';

interface ReadinessGate {
  key: string;
  status: GateStatus;
  label: string;
}

interface ReadinessInfo {
  status: 'ready' | 'blocked' | 'pending';
  blockingCount: number;
  pendingCount: number;
  passedCount: number;
  total: number;
  label: string;
  currentStep: string;
  gates: ReadinessGate[];
}

interface TripRow {
  id: string;
  status: string;
  createdAt: Date | null;
  issuedAt: Date | null;
  vehicleId: string | null;
  requestId: string | null;
  make: string | null;
  model: string | null;
  licenceNumber: string | null;
  vehicleStatus: string | null;
  vehicleLicenceExpiryDate: string | null;
  requestReference: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
  driverEmployeeId: string | null;
  allocationState: string | null;
  allocationEndAt: Date | null;
  requiredLicenceClass: string | null;
  readiness: ReadinessInfo;
}

interface DashboardData {
  trips: TripRow[];
  summary: { total: number; ready: number; blocked: number; pending: number };
  topBlockers: { key: string; count: number }[];
}

const GATE_LABELS: Record<string, string> = {
  request_approvals: 'Approvals',
  releasing_officer_acted: 'Release action',
  vehicle_allocated: 'Vehicle',
  driver_allocated: 'Driver',
  driver_active_employee: 'Driver employment',
  driver_licence_valid: 'Driver licence',
  driver_licence_class_match: 'Licence class',
  vehicle_no_blocking_defects: 'Defects',
  trip_authority: 'Authority',
  driver_acknowledged: 'Driver acceptance',
  departure_inspection: 'Inspection',
  authority_validity: 'Authority validity',
  vehicle_documents: 'Vehicle documents',
  vehicle_issued: 'Vehicle issue',
};

const GATE_ORDER = [
  'request_approvals',
  'releasing_officer_acted',
  'vehicle_allocated',
  'driver_allocated',
  'driver_active_employee',
  'driver_licence_valid',
  'driver_licence_class_match',
  'vehicle_no_blocking_defects',
  'trip_authority',
  'driver_acknowledged',
  'departure_inspection',
  'authority_validity',
  'vehicle_documents',
  'vehicle_issued',
] as const;

function resolveCurrentStep(gates: ReadinessGate[]) {
  const rank = new Map<string, number>(GATE_ORDER.map((key, index) => [key, index]));
  return [...gates]
    .filter((gate) => gate.status !== 'pass')
    .sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999))[0];
}

async function computeReadinessDashboard(tenantId: string): Promise<DashboardData> {
  const db = getDb();
  const tripRows = await db
    .select({
      id: trips.id,
      status: trips.status,
      createdAt: trips.createdAt,
      issuedAt: trips.issuedAt,
      vehicleId: trips.vehicleId,
      requestId: trips.requestId,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      vehicleStatus: vehicles.status,
      vehicleLicenceExpiryDate: vehicles.licenceExpiryDate,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      requestReference: transportRequests.reference,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      allocationState: vehicleAllocations.state,
      allocationEndAt: vehicleAllocations.endAt,
    })
    .from(trips)
    .innerJoin(vehicles, and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)))
    .innerJoin(
      transportRequests,
      and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, tenantId)),
    )
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
    .where(and(eq(trips.tenantId, tenantId), eq(trips.status, 'pending')))
    .orderBy(desc(trips.createdAt));

  const enrichedTrips: TripRow[] = await Promise.all(
    tripRows.map(async (trip) => {
      const gates: ReadinessGate[] = [];

      const [workflow] = await db
        .select({
          id: workflowInstances.id,
          status: workflowInstances.status,
          definitionId: workflowInstances.definitionId,
        })
        .from(workflowInstances)
        .where(eq(workflowInstances.requestId, trip.requestId))
        .limit(1);

      let releaseAction: { id: string } | null = null;
      let releaseStepExists = false;
      if (workflow?.id && workflow.definitionId) {
        const [releaseStep] = await db
          .select({ stepOrder: workflowSteps.stepOrder })
          .from(workflowSteps)
          .where(
            and(
              eq(workflowSteps.definitionId, workflow.definitionId),
              eq(workflowSteps.actionType, 'release'),
            ),
          )
          .orderBy(workflowSteps.stepOrder)
          .limit(1);

        if (releaseStep) {
          releaseStepExists = true;
          [releaseAction] = await db
            .select({ id: workflowActions.id })
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflow.id),
                eq(workflowActions.stepOrder, releaseStep.stepOrder),
                eq(workflowActions.actionType, 'release'),
                sql`${workflowActions.result} IN ('released', 'approved')`,
              ),
            )
            .limit(1);
        }
      }

      const requestApproved =
        workflow?.status === 'approved' ||
        workflow?.status === 'completed' ||
        Boolean(releaseAction);
      gates.push({
        key: 'request_approvals',
        status: requestApproved ? 'pass' : 'blocking',
        label: GATE_LABELS.request_approvals,
      });
      if (releaseStepExists) {
        gates.push({
          key: 'releasing_officer_acted',
          status: releaseAction ? 'pass' : 'blocking',
          label: GATE_LABELS.releasing_officer_acted,
        });
      }

      gates.push({
        key: 'vehicle_allocated',
        status: trip.vehicleId && trip.allocationState === 'confirmed' ? 'pass' : 'blocking',
        label: GATE_LABELS.vehicle_allocated,
      });
      gates.push({
        key: 'driver_allocated',
        status: trip.driverEmployeeId ? 'pass' : 'blocking',
        label: GATE_LABELS.driver_allocated,
      });

      let driverProfile:
        | {
            driverStatus: string;
            licenceClass: string | null;
            expiryDate: string | null;
            verificationStatus: string | null;
            employmentStatus: string;
          }
        | undefined;
      if (trip.driverEmployeeId) {
        [driverProfile] = await db
          .select({
            driverStatus: driverProfiles.driverStatus,
            licenceClass: driverLicences.licenceClass,
            expiryDate: driverLicences.expiryDate,
            verificationStatus: driverLicences.verificationStatus,
            employmentStatus: employees.employmentStatus,
          })
          .from(driverProfiles)
          .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
          .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
          .where(
            and(
              eq(driverProfiles.employeeId, trip.driverEmployeeId),
              eq(employees.tenantId, tenantId),
              eq(driverLicences.isActive, true),
              eq(driverLicences.isVerified, true),
            ),
          )
          .orderBy(desc(driverLicences.version))
          .limit(1);

        const employeeActive = driverProfile?.employmentStatus === 'active';
        gates.push({
          key: 'driver_active_employee',
          status: employeeActive ? 'pass' : 'blocking',
          label: GATE_LABELS.driver_active_employee,
        });

        const expiry = driverProfile?.expiryDate
          ? new Date(`${driverProfile.expiryDate}T23:59:59.999Z`)
          : null;
        const licenceValid =
          !!driverProfile &&
          driverProfile.driverStatus === 'authorised' &&
          driverProfile.verificationStatus === 'verified' &&
          !!expiry &&
          !!trip.allocationEndAt &&
          expiry >= trip.allocationEndAt;
        gates.push({
          key: 'driver_licence_valid',
          status: licenceValid ? 'pass' : driverProfile ? 'blocking' : 'pending',
          label: GATE_LABELS.driver_licence_valid,
        });

        if (trip.requiredLicenceClass && driverProfile?.licenceClass) {
          const classCovered = namibiaLicenceClassCovers(
            driverProfile.licenceClass,
            trip.requiredLicenceClass,
          );
          gates.push({
            key: 'driver_licence_class_match',
            status: classCovered ? 'pass' : 'blocking',
            label: GATE_LABELS.driver_licence_class_match,
          });
        }
      }

      const [defect] = await db
        .select({ count: sql<number>`count(*)` })
        .from(vehicleDefects)
        .innerJoin(vehicles, eq(vehicles.id, vehicleDefects.vehicleId))
        .where(
          and(
            eq(vehicleDefects.vehicleId, trip.vehicleId),
            eq(vehicles.tenantId, tenantId),
            isNull(vehicleDefects.resolvedAt),
            eq(vehicleDefects.isBlocking, true),
          ),
        );
      gates.push({
        key: 'vehicle_no_blocking_defects',
        status: Number(defect?.count || 0) === 0 ? 'pass' : 'blocking',
        label: GATE_LABELS.vehicle_no_blocking_defects,
      });

      const [authority] = await db
        .select({
          id: tripAuthorities.id,
          status: tripAuthorities.status,
          validFrom: tripAuthorities.validFrom,
          validUntil: tripAuthorities.validUntil,
        })
        .from(tripAuthorities)
        .where(and(eq(tripAuthorities.tripId, trip.id), eq(tripAuthorities.tenantId, tenantId)))
        .limit(1);
      gates.push({
        key: 'trip_authority',
        status: authority ? 'pass' : 'blocking',
        label: GATE_LABELS.trip_authority,
      });

      if (authority) {
        const acceptedStatuses = new Set([
          'driver_accepted',
          'awaiting_pre_trip_inspection',
          'ready_for_departure',
          'in_progress',
        ]);
        gates.push({
          key: 'driver_acknowledged',
          status: acceptedStatuses.has(authority.status) ? 'pass' : 'pending',
          label: GATE_LABELS.driver_acknowledged,
        });

        const now = new Date();
        const withinValidity =
          (!authority.validFrom || now >= authority.validFrom) &&
          (!authority.validUntil || now <= authority.validUntil);
        gates.push({
          key: 'authority_validity',
          status: withinValidity ? 'pass' : 'blocking',
          label: GATE_LABELS.authority_validity,
        });
      }

      const [dep] = await db
        .select({ status: vehicleInspections.status, overallPass: vehicleInspections.overallPass })
        .from(vehicleInspections)
        .where(
          and(
            eq(vehicleInspections.tenantId, tenantId),
            eq(vehicleInspections.tripId, trip.id),
            eq(vehicleInspections.vehicleId, trip.vehicleId),
            eq(vehicleInspections.type, 'departure'),
          ),
        )
        .orderBy(desc(vehicleInspections.createdAt))
        .limit(1);
      const inspectionDone = dep?.status === 'completed' || dep?.status === 'failed';
      const inspectionPassed = dep?.status === 'completed' && dep.overallPass === true;
      gates.push({
        key: 'departure_inspection',
        status: inspectionPassed ? 'pass' : inspectionDone ? 'blocking' : 'pending',
        label: GATE_LABELS.departure_inspection,
      });

      const vehicleLicenceValid =
        !trip.vehicleLicenceExpiryDate ||
        !trip.allocationEndAt ||
        new Date(`${trip.vehicleLicenceExpiryDate}T23:59:59.999Z`) >= trip.allocationEndAt;
      const usableVehicleStatus =
        !!trip.vehicleStatus &&
        !['maintenance', 'out_of_service', 'written_off', 'decommissioned', 'expired'].includes(
          trip.vehicleStatus,
        );
      gates.push({
        key: 'vehicle_documents',
        status: usableVehicleStatus && vehicleLicenceValid ? 'pass' : 'blocking',
        label: GATE_LABELS.vehicle_documents,
      });

      gates.push({
        key: 'vehicle_issued',
        status: trip.issuedAt ? 'pass' : 'pending',
        label: GATE_LABELS.vehicle_issued,
      });

      const blockingCount = gates.filter((gate) => gate.status === 'blocking').length;
      const pendingCount = gates.filter((gate) => gate.status === 'pending').length;
      const passedCount = gates.filter((gate) => gate.status === 'pass').length;
      const status: 'ready' | 'blocked' | 'pending' =
        blockingCount > 0 ? 'blocked' : pendingCount > 0 ? 'pending' : 'ready';
      const currentStep = resolveCurrentStep(gates);
      const label =
        status === 'ready'
          ? 'Ready for departure'
          : status === 'blocked'
            ? `${blockingCount} gate${blockingCount === 1 ? '' : 's'} blocking`
            : `${pendingCount} step${pendingCount === 1 ? '' : 's'} pending`;

      return {
        ...trip,
        readiness: {
          status,
          blockingCount,
          pendingCount,
          passedCount,
          total: gates.length,
          label,
          currentStep: currentStep?.label ?? 'Release conditions complete',
          gates,
        },
      };
    }),
  );

  const ready = enrichedTrips.filter((trip) => trip.readiness.status === 'ready').length;
  const blocked = enrichedTrips.filter((trip) => trip.readiness.status === 'blocked').length;
  const pending = enrichedTrips.filter((trip) => trip.readiness.status === 'pending').length;

  const gateCounts = new Map<string, number>();
  for (const trip of enrichedTrips) {
    for (const gate of trip.readiness.gates) {
      if (gate.status === 'blocking') {
        gateCounts.set(gate.key, (gateCounts.get(gate.key) || 0) + 1);
      }
    }
  }

  return {
    trips: enrichedTrips,
    summary: { total: enrichedTrips.length, ready, blocked, pending },
    topBlockers: [...gateCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count })),
  };
}

export default async function ReadinessDashboardPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Trips', href: '/dashboard/trips' },
            { label: 'Release Readiness' },
          ]}
        />
        <PageHeader title="Release Readiness" description="Overview of trip readiness status" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Trips', href: '/dashboard/trips' },
            { label: 'Release Readiness' },
          ]}
        />
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
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Trips', href: '/dashboard/trips' },
            { label: 'Release Readiness' },
          ]}
        />
        <PageHeader title="Release Readiness" description="Overview of trip readiness status" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load"
          description="The dashboard query failed. Ensure the database is seeded."
        />
      </div>
    );
  }

  const { trips, summary, topBlockers } = data;
  const readyTrips = trips.filter((trip) => trip.readiness.status === 'ready');
  const blockedTrips = trips.filter((trip) => trip.readiness.status === 'blocked');
  const pendingTrips = trips.filter((trip) => trip.readiness.status === 'pending');

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Trips', href: '/dashboard/trips' },
          { label: 'Release Readiness' },
        ]}
      />
      <PageHeader
        title="Release Readiness"
        description={`${summary.total} trips awaiting departure — ${summary.ready} ready, ${summary.blocked} blocked, ${summary.pending} pending`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/trips">
            <ChevronRight className="h-4 w-4" /> All Trips
          </Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{summary.total}</p>
            <p className="text-xs text-ink-500">Awaiting Departure</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{summary.ready}</p>
            <p className="text-xs text-ink-500">Ready for Departure</p>
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
            <p className="text-xs text-ink-500">Waiting on Next Step</p>
          </CardContent>
        </Card>
      </div>

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
              {topBlockers.map((blocker) => (
                <Badge key={blocker.key} variant="error" size="sm" className="text-xs">
                  {GATE_LABELS[blocker.key] || blocker.key}: {blocker.count} trip
                  {blocker.count !== 1 ? 's' : ''}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {blockedTrips.length > 0 && (
        <TripGroup title={`Blocked (${blockedTrips.length})`} tone="blocked" trips={blockedTrips} />
      )}
      {pendingTrips.length > 0 && (
        <TripGroup title={`Waiting on Next Step (${pendingTrips.length})`} tone="pending" trips={pendingTrips} />
      )}
      {readyTrips.length > 0 && (
        <TripGroup title={`Ready for Departure (${readyTrips.length})`} tone="ready" trips={readyTrips} />
      )}

      {trips.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No Trips Awaiting Departure"
          description="There are no pending trips requiring release-readiness review."
        />
      )}
    </div>
  );
}

function TripGroup({
  title,
  tone,
  trips,
}: {
  title: string;
  tone: 'ready' | 'blocked' | 'pending';
  trips: TripRow[];
}) {
  const Icon = tone === 'ready' ? CheckCircle2 : tone === 'blocked' ? XCircle : Clock;
  const className =
    tone === 'ready'
      ? 'text-status-success-text'
      : tone === 'blocked'
        ? 'text-status-error-text'
        : 'text-status-pending-text';
  return (
    <section>
      <h3 className={`mb-3 flex items-center gap-2 text-sm font-semibold ${className}`}>
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      <div className="space-y-2">
        {trips.map((trip) => (
          <ReadinessTripCard key={trip.id} trip={trip} />
        ))}
      </div>
    </section>
  );
}

function ReadinessTripCard({ trip }: { trip: TripRow }) {
  const readiness = trip.readiness;
  const requesterName =
    trip.requesterFirstName && trip.requesterLastName
      ? `${trip.requesterFirstName} ${trip.requesterLastName}`
      : null;

  return (
    <Link
      href={`/dashboard/trips/${trip.id}`}
      className="focus-ring block rounded-[10px] border border-border bg-surface p-4 transition-colors hover:bg-muted/30 motion-reduce:transition-none sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] sm:h-12 sm:w-12 ${
              readiness.status === 'ready'
                ? 'bg-status-success-bg text-status-success-text'
                : readiness.status === 'blocked'
                  ? 'bg-status-error-bg text-status-error-text'
                  : 'bg-status-pending-bg text-status-pending-text'
            }`}
          >
            {readiness.status === 'ready' ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : readiness.status === 'blocked' ? (
              <XCircle className="h-6 w-6" />
            ) : (
              <Clock className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-[650] text-ink-950">
                {trip.make} {trip.model}
              </p>
              <StatusBadge
                status={
                  readiness.status === 'ready'
                    ? 'success'
                    : readiness.status === 'blocked'
                      ? 'error'
                      : 'pending'
                }
                label={readiness.label}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              <span className="tabular-nums">{trip.licenceNumber}</span>
              {trip.requestReference && <span>{trip.requestReference}</span>}
              {requesterName && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {requesterName}
                </span>
              )}
              <span className="tabular-nums">{trip.createdAt ? formatDate(trip.createdAt) : '—'}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
              <CircleDot className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">Current step:</span>
              <span>{readiness.currentStep}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 sm:shrink-0 sm:border-0 sm:pt-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            <span className="text-xs font-medium tabular-nums text-ink-500">
              {readiness.passedCount}/{readiness.total}
            </span>
            <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted sm:w-20 sm:flex-none">
              <div
                className="h-full bg-status-success-text"
                style={{
                  width: `${(readiness.passedCount / Math.max(1, readiness.total)) * 100}%`,
                }}
              />
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
        </div>
      </div>
    </Link>
  );
}
