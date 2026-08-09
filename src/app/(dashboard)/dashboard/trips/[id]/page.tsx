import { getDb, isDbConnected } from '@/db';
import { trips, tripIncidents, tripLogEntries, fuelTransactions, vehicleInspections, tripIssues, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests, requestRoutes } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { statusConfig } from '@/lib/request-status';
import { notFound } from 'next/navigation';
import {
  Truck, ChevronLeft, User, CalendarDays, Clock, Gauge, CheckCircle2, XCircle, AlertTriangle, FileText, UserCheck as UserCheckIcon,
} from 'lucide-react';
import { TripActions } from '../components/TripActions';
import { ReleaseReadinessCheck } from '../components/ReleaseReadinessCheck';
import { DriverTripWorkspace } from '../components/DriverTripWorkspace';
import Link from 'next/link';
import { resolveDashboardAccess, SystemRoles, type DashboardRecordScope } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';

interface PageProps {
  params: Promise<{ id: string }>;
}

const TRIP_STATUS_LABELS: Record<string, string> = {
  pending: statusConfig('pending').label, in_progress: statusConfig('in_progress').label, return_due: statusConfig('return_due').label,
  return_inspection: statusConfig('return_inspection').label, closure_review: statusConfig('closure_review').label, closed: statusConfig('closed').label,
};

const TRIP_STATUS_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  pending: statusConfig('pending').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  in_progress: statusConfig('in_progress').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_due: statusConfig('return_due').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  return_inspection: statusConfig('return_inspection').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  closure_review: statusConfig('closure_review').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
  closed: statusConfig('closed').variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency',
};

async function fetchTripDetail(
  id: string,
  tenantId: string,
  userId: string,
  recordScope: DashboardRecordScope,
) {
  const db = getDb();

  const trip = await db
    .select({
      id: trips.id,
      status: trips.status,
      issuedAt: trips.issuedAt,
      startedAt: trips.startedAt,
      returnedAt: trips.returnedAt,
      closedAt: trips.closedAt,
      createdAt: trips.createdAt,
      vehicleId: trips.vehicleId,
      allocationId: trips.allocationId,
      requestId: trips.requestId,
      driverAcknowledgedAt: trips.driverAcknowledgedAt,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      currentOdometer: vehicles.currentOdometer,
      requestReference: transportRequests.reference,
      requestScope: transportRequests.scope,
      requestPurpose: transportRequests.purpose,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
    })
    .from(trips)
    .leftJoin(vehicles, and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)))
    .leftJoin(
      transportRequests,
      and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, tenantId)),
    )
    .leftJoin(
      employees,
      and(eq(transportRequests.requesterEmployeeId, employees.id), eq(employees.tenantId, tenantId)),
    )
    .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
    .where(and(
      eq(trips.id, id),
      tripScopeCondition({ tenantId, userId, recordScope }),
    ))
    .then((r) => r[0] ?? null);

  if (!trip) notFound();

  const [issueRecord, logEntries, fuel, inspections, routeRows, incidents] = await Promise.all([
    db
      .select({
        id: tripIssues.id,
        issuedAt: tripIssues.issuedAt,
        issueOdometer: tripIssues.issueOdometer,
        keysIssued: tripIssues.keysIssued,
        fuelCardIssued: tripIssues.fuelCardIssued,
        acknowledgedAt: tripIssues.acknowledgedAt,
        acknowledgedByDriverId: tripIssues.acknowledgedByDriverId,
        notes: tripIssues.notes,
      })
      .from(tripIssues)
      .where(eq(tripIssues.allocationId, trip.allocationId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: tripLogEntries.id,
        logDate: tripLogEntries.logDate,
        odometerOut: tripLogEntries.odometerOut,
        odometerIn: tripLogEntries.odometerIn,
        departureTime: tripLogEntries.departureTime,
        arrivalTime: tripLogEntries.arrivalTime,
        origin: tripLogEntries.origin,
        destination: tripLogEntries.destination,
        distanceKm: tripLogEntries.distanceKm,
        remarks: tripLogEntries.remarks,
        driverFirstName: employees.firstName,
        driverLastName: employees.lastName,
      })
      .from(tripLogEntries)
      .leftJoin(
        employees,
        and(eq(tripLogEntries.driverEmployeeId, employees.id), eq(employees.tenantId, tenantId)),
      )
      .where(eq(tripLogEntries.tripId, id))
      .orderBy(tripLogEntries.logDate),
    db
      .select()
      .from(fuelTransactions)
      .where(eq(fuelTransactions.tripId, id))
      .orderBy(fuelTransactions.transactionAt),
    db
      .select()
      .from(vehicleInspections)
      .where(and(eq(vehicleInspections.tripId, id), eq(vehicleInspections.tenantId, tenantId)))
      .orderBy(desc(vehicleInspections.createdAt)),
    trip.requestId
      ? db.select().from(requestRoutes).where(eq(requestRoutes.requestId, trip.requestId))
      : Promise.resolve([] as typeof requestRoutes.$inferSelect[]),
    db.select().from(tripIncidents)
      .where(and(eq(tripIncidents.tripId, id), eq(tripIncidents.tenantId, tenantId)))
      .orderBy(desc(tripIncidents.occurredAt)),
  ]);

  const totalFuelLitres = fuel.reduce((sum, f) => sum + Number(f.litres), 0);
  const totalFuelCost = fuel.reduce((sum, f) => sum + Number(f.amount), 0);
  const totalLogKm = logEntries.reduce((sum, e) => sum + (e.distanceKm ?? 0), 0);
  const routeKm = Math.round(routeRows.reduce((sum, r) => sum + (r.totalKilometres ?? r.mappedDistanceKm ?? 0), 0));

  return { trip, issueRecord, logEntries, fuel, inspections, incidents, totalFuelLitres, totalFuelCost, totalLogKm, routeKm };
}

export default async function TripDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Trip Detail' }]} />
        <PageHeader title="Trip Detail" description="Trip could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view trip details." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Trip Detail' }]} />
        <PageHeader title="Trip Detail" description="Trip could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set DATABASE_URL and run migrations." />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/trips', roleNames);
  if (!access.allowed || !access.actions.includes('view')) notFound();

  let data: Awaited<ReturnType<typeof fetchTripDetail>>;
  try {
    data = await fetchTripDetail(
      id,
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'assigned',
    );
  } catch (error) {
    console.error('Trip detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'Trip Detail' }]} />
        <PageHeader title="Trip Detail" description="Trip could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Trip" description="The database query failed." />
      </div>
    );
  }

  const { trip, issueRecord, logEntries, fuel, inspections, incidents } = data;
  const permissionCodes = await getSessionPermissions(session);
  const isDriver = roleNames.includes(SystemRoles.DRIVER);
  const canOperate = access.actions.includes('update');
  const variant = TRIP_STATUS_VARIANTS[trip.status] ?? 'info';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Trips', href: '/dashboard/trips' },
        { label: `${trip.make} ${trip.model}` },
      ]} />
      <PageHeader
        title={`${trip.make} ${trip.model}`}
        description={`${trip.licenceNumber}${trip.vehicleRegisterNumber ? ` · ${trip.vehicleRegisterNumber}` : ''}`}
      >
        <div className="flex items-center gap-2">
          {canOperate && !isDriver && <TripActions
              tripId={trip.id}
              allocationId={trip.allocationId!}
              status={trip.status}
              vehicleId={trip.vehicleId}
              vehicle={trip.make && trip.model ? {
                id: trip.vehicleId,
                make: trip.make,
                model: trip.model,
                licenceNumber: trip.licenceNumber || '',
                currentOdometer: trip.currentOdometer,
              } : undefined}
              hasIssue={!!issueRecord}
              hasAcknowledge={!!trip.driverAcknowledgedAt}
              hasDepartureInspection={inspections.some((inspection) => inspection.type === 'departure' && inspection.overallPass)}
              canManage={permissionCodes.includes(Permissions.TRIP_MANAGE)}
              canDrive={permissionCodes.includes(Permissions.DRIVER_LOG_CREATE)}
              canInspect={permissionCodes.includes(Permissions.INSPECTION_PERFORM)}
              canReplaceVehicle={permissionCodes.includes(Permissions.ALLOCATION_MANAGE)}
              currentOdometer={trip.currentOdometer ?? undefined}
            />}
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/trips"><ChevronLeft className="h-4 w-4" /> Back to Trips</Link>
          </Button>
        </div>
      </PageHeader>

      {isDriver && (
        <DriverTripWorkspace tripId={trip.id} />
      )}

      {(trip.status === 'pending' || trip.status === 'in_progress') && (
        <ReleaseReadinessCheck tripId={trip.id} status={trip.status} />
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
              <Truck className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{trip.make} {trip.model}</h2>
                <StatusBadge status={variant} label={TRIP_STATUS_LABELS[trip.status] ?? trip.status} />
                <Badge variant="info" size="sm">{trip.licenceNumber}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{trip.requestReference || 'No request reference'}</span>
                {trip.requesterFirstName && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{trip.requesterFirstName} {trip.requesterLastName}</span>}
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Created {formatDate(trip.createdAt)}</span>
                {trip.issuedAt && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Issued {formatDateTime(trip.issuedAt)}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{data.routeKm > 0 ? `${data.routeKm.toLocaleString()} km` : '—'}</p><p className="text-xs text-ink-500">Planned Route</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{data.totalLogKm.toLocaleString()} km</p><p className="text-xs text-ink-500">Logged Distance</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{logEntries.length}</p><p className="text-xs text-ink-500">Log Entries</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{data.totalFuelLitres.toFixed(1)} L</p><p className="text-xs text-ink-500">Fuel Used</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{formatCurrency(data.totalFuelCost)}</p><p className="text-xs text-ink-500">Fuel Cost</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className={`text-2xl font-[650] tabular-nums ${incidents.length ? 'text-status-error-text' : 'text-ink-950'}`}>{incidents.length}</p><p className="text-xs text-ink-500">Trip Events</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Trip Timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <TimelineItem icon={<FileText />} title="Request" subtitle={trip.requestReference ?? '—'} time={formatDate(trip.createdAt)} status="complete" />
            <TimelineItem icon={<Truck />} title="Vehicle Issued" subtitle={issueRecord ? `${issueRecord.keysIssued ? 'Keys ✓' : ''}${issueRecord.fuelCardIssued ? ' Fuel Card ✓' : ''}` : undefined} time={issueRecord?.issuedAt ? formatDateTime(issueRecord.issuedAt) : trip.issuedAt ? formatDateTime(trip.issuedAt) : 'Pending'} status={issueRecord ? 'complete' : 'pending'} />
            <TimelineItem icon={<UserCheckIcon />} title="Driver Acknowledged" time={issueRecord?.acknowledgedAt ? formatDateTime(issueRecord.acknowledgedAt) : 'Pending'} status={issueRecord?.acknowledgedAt ? 'complete' : 'pending'} />
            <TimelineItem icon={<Gauge />} title="Trip Started" time={trip.startedAt ? formatDateTime(trip.startedAt) : 'Pending'} status={trip.startedAt ? 'complete' : 'pending'} />
            <TimelineItem icon={<CheckCircle2 />} title="Returned" time={trip.returnedAt ? formatDateTime(trip.returnedAt) : 'Pending'} status={trip.returnedAt ? 'complete' : 'pending'} />
            <TimelineItem icon={<Clock />} title="Closed" time={trip.closedAt ? formatDateTime(trip.closedAt) : 'Pending'} status={trip.closedAt ? 'complete' : 'pending'} />
          </div>
        </CardContent>
      </Card>

      {incidents.length > 0 && (
        <Card className="border-status-error-text/30">
          <CardHeader><CardTitle>Incident, Accident and Defect Timeline ({incidents.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {incidents.map((incident) => (
              <article key={incident.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{incident.officialNumber || 'Number pending'}</p>
                    <p className="text-xs capitalize text-ink-500">{incident.incidentType.replaceAll('_', ' ')} · {formatDateTime(incident.occurredAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={incident.severity === 'critical' || incident.severity === 'serious' ? 'error' : 'pending'} size="sm">{incident.severity}</Badge>
                    <Badge variant={incident.status === 'resolved' ? 'success' : 'info'} size="sm">{incident.status.replaceAll('_', ' ')}</Badge>
                    {incident.detailsRequired && <Badge variant="pending" size="sm">Additional details required</Badge>}
                  </div>
                </div>
                <p className="mt-2 text-sm text-ink-700">{incident.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                  {incident.location && <span>{incident.location}</span>}
                  {incident.odometerReading != null && <span>{incident.odometerReading.toLocaleString()} km</span>}
                  <span className="capitalize">{incident.continuationState.replaceAll('_', ' ')}</span>
                  {incident.offlineCreatedAt && <span>Created offline · synced</span>}
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      )}

      {inspections.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Inspections ({inspections.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {inspections.map((insp) => (
                <div key={insp.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${insp.overallPass ? 'bg-status-success-bg text-status-success-text' : 'bg-status-error-bg text-status-error-text'}`}>
                        {insp.overallPass ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-950 capitalize">{insp.type} Inspection</p>
                        <p className="text-xs text-ink-500">
                          {formatDate(insp.createdAt)}
                          {insp.odometerReading && ` · ${insp.odometerReading.toLocaleString()} km`}
                          {insp.fuelLevel && ` · Fuel: ${insp.fuelLevel.replace(/_/g, ' ')}`}
                        </p>
                      </div>
                    </div>
                    <Badge variant={insp.overallPass ? 'success' : 'error'} size="sm">{insp.overallPass ? 'Pass' : 'Fail'}</Badge>
                  </div>
                  {insp.notes && <p className="mt-2 text-xs text-ink-500">{insp.notes}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {logEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Daily Log Entries ({logEntries.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Driver</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Route</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Odometer</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Km</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logEntries.map((entry) => {
                    const driverName = entry.driverFirstName && entry.driverLastName
                      ? `${entry.driverFirstName} ${entry.driverLastName}`
                      : '—';
                    return (
                      <tr key={entry.id} className="hover:bg-canvas/50">
                        <td className="px-3 py-2 text-xs text-ink-500">{formatDate(entry.logDate)}</td>
                        <td className="px-3 py-2 text-xs text-ink-700">{driverName}</td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {[entry.origin, entry.destination].filter(Boolean).join(' → ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-500">
                          {entry.odometerOut ? `${entry.odometerOut.toLocaleString()}` : ''}
                          {entry.odometerIn ? ` - ${entry.odometerIn.toLocaleString()}` : ''}
                        </td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums font-medium text-ink-950">
                          {entry.distanceKm ? `${entry.distanceKm.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {entry.departureTime && entry.arrivalTime
                            ? `${entry.departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${entry.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {fuel.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Fuel Transactions ({fuel.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Station</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Litres</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Method</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fuel.map((f) => (
                    <tr key={f.id} className="hover:bg-canvas/50">
                      <td className="px-3 py-2 text-xs text-ink-500">{formatDate(f.transactionAt)}</td>
                      <td className="px-3 py-2 text-xs text-ink-700">{f.stationName || '—'}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-500">{Number(f.litres).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums font-medium text-ink-950">{formatCurrency(Number(f.amount))}</td>
                      <td className="px-3 py-2 text-xs text-ink-500 capitalize">{f.paymentMethod.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2">
                        <Badge variant={f.isVerified ? 'success' : 'pending'} size="sm">{f.isVerified ? 'Verified' : 'Pending'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {inspections.length === 0 && logEntries.length === 0 && fuel.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-ink-500">
              <AlertTriangle className="h-4 w-4" />
              No inspections, log entries or fuel records for this trip yet.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TimelineItem({
  icon, title, subtitle, time, status: itemStatus,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  status: 'complete' | 'pending';
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${itemStatus === 'complete' ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-400'}`}>
          {icon}
        </div>
        <div className={`mt-1 h-full w-px ${itemStatus === 'complete' ? 'bg-status-success-bg' : 'bg-border'}`} />
      </div>
      <div className="pb-4">
        <p className={`text-sm font-medium ${itemStatus === 'complete' ? 'text-ink-950' : 'text-ink-500'}`}>
          {title}
        </p>
        {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
        <p className="text-xs text-ink-400 mt-0.5">{time}</p>
      </div>
    </div>
  );
}
