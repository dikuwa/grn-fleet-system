import Link from 'next/link';
import { and, desc, eq, inArray, like, or } from 'drizzle-orm';
import { AlertTriangle, CarFront, CheckCircle2, FileText, Search } from 'lucide-react';
import { getDb } from '@/db';
import { tripIncidents, trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getServerSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';

const MVA_CODES = [
  'accident',
  'accident_collision',
  'passenger_injury',
  'driver_injury',
  'third_party_injury',
  'third_party_vehicle_damage',
  'property_damage',
];

export default async function MvaWorkspacePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await getServerSession();
  if (!session) notFound();
  const permissions = await getSessionPermissions(session);
  const allowed = [
    Permissions.TRIP_INCIDENT_MANAGE,
    Permissions.INCIDENT_INVESTIGATE,
    Permissions.INCIDENT_CLOSE_INVESTIGATION,
    Permissions.INCIDENT_INSURANCE_UPDATE,
    Permissions.INCIDENT_TECHNICAL_CLEARANCE,
    Permissions.MAINTENANCE_MANAGE,
    Permissions.AUDIT_READ,
  ].some((permission) => permissions.includes(permission));
  if (!allowed) notFound();

  const { status = 'open' } = await searchParams;
  const db = getDb();
  const mvaCondition = or(
    like(tripIncidents.officialNumber, 'ACC-%'),
    inArray(tripIncidents.incidentCategoryCode, MVA_CODES),
  );
  const statusCondition = status === 'resolved'
    ? eq(tripIncidents.investigationStatus, 'closed')
    : status === 'all'
      ? undefined
      : inArray(tripIncidents.investigationStatus, ['pending', 'in_progress', 'awaiting_information', 'no_action']);

  const rows = await db
    .select({
      id: tripIncidents.id,
      officialNumber: tripIncidents.officialNumber,
      incidentType: tripIncidents.incidentType,
      severity: tripIncidents.severity,
      occurredAt: tripIncidents.occurredAt,
      location: tripIncidents.location,
      description: tripIncidents.description,
      investigationStatus: tripIncidents.investigationStatus,
      technicalClearanceStatus: tripIncidents.technicalClearanceStatus,
      insuranceNotified: tripIncidents.insuranceNotified,
      policeReportFiled: tripIncidents.policeReportFiled,
      detailsRequired: tripIncidents.detailsRequired,
      tripId: tripIncidents.tripId,
      tripStatus: trips.status,
      vehicleId: vehicles.id,
      vehicleLicence: vehicles.licenceNumber,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleStatus: vehicles.status,
      requestReference: transportRequests.reference,
    })
    .from(tripIncidents)
    .innerJoin(trips, and(eq(trips.id, tripIncidents.tripId), eq(trips.tenantId, session.tenantId)))
    .innerJoin(vehicles, and(eq(vehicles.id, trips.vehicleId), eq(vehicles.tenantId, session.tenantId)))
    .leftJoin(transportRequests, and(eq(transportRequests.id, trips.requestId), eq(transportRequests.tenantId, session.tenantId)))
    .where(and(eq(tripIncidents.tenantId, session.tenantId), mvaCondition, statusCondition))
    .orderBy(desc(tripIncidents.occurredAt));

  const openCount = rows.filter((row) => row.investigationStatus !== 'closed').length;
  const seriousCount = rows.filter((row) => ['serious', 'critical'].includes(row.severity)).length;
  const clearanceCount = rows.filter((row) => row.technicalClearanceStatus !== 'cleared' && row.vehicleStatus === 'maintenance').length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'MVA & Incidents' }]} />
      <PageHeader title="MVA & Incident Workspace" description="Investigate motor vehicle accidents, track police and insurance follow-up, technical clearance and vehicle return to service." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-4"><p className="text-ink-500 text-xs">Open investigations</p><p className="text-ink-950 mt-1 text-2xl font-semibold tabular-nums">{openCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-ink-500 text-xs">Serious / critical</p><p className="text-status-error-text mt-1 text-2xl font-semibold tabular-nums">{seriousCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-ink-500 text-xs">Awaiting technical clearance</p><p className="text-status-pending-text mt-1 text-2xl font-semibold tabular-nums">{clearanceCount}</p></CardContent></Card>
      </div>

      <div className="border-border bg-surface flex flex-wrap gap-2 rounded-[10px] border p-2">
        {[
          ['open', 'Open'],
          ['resolved', 'Resolved'],
          ['all', 'All'],
        ].map(([value, label]) => (
          <Button key={value} size="sm" variant={status === value ? 'primary' : 'ghost'} asChild>
            <Link href={`/dashboard/trips/incidents?status=${value}`}>{label}</Link>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="No MVA records in this view" description="New accident and injury reports will appear here automatically from active trips." />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="border-border bg-surface hover:border-brand-300 rounded-[10px] border p-4 transition-colors motion-reduce:transition-none">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-950 font-mono text-sm font-semibold">{row.officialNumber || 'Number pending'}</span>
                    <Badge variant={row.severity === 'critical' || row.severity === 'serious' ? 'error' : 'pending'} size="sm">{row.severity}</Badge>
                    <Badge variant={row.investigationStatus === 'closed' ? 'success' : 'info'} size="sm">{row.investigationStatus.replaceAll('_', ' ')}</Badge>
                    {row.detailsRequired && <Badge variant="warning" size="sm">Details required</Badge>}
                  </div>
                  <p className="text-ink-950 mt-2 text-sm font-medium capitalize">{row.incidentType.replaceAll('_', ' ')}</p>
                  <p className="text-ink-600 mt-1 line-clamp-2 text-sm">{row.description}</p>
                  <div className="text-ink-500 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>{formatDateTime(row.occurredAt)}</span>
                    {row.location && <span>{row.location}</span>}
                    <span>{row.vehicleLicence} · {row.vehicleMake} {row.vehicleModel}</span>
                    {row.requestReference && <span>{row.requestReference}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="border-border rounded-full border px-2.5 py-1">Police: {row.policeReportFiled ? 'filed' : 'pending'}</span>
                    <span className="border-border rounded-full border px-2.5 py-1">Insurance: {row.insuranceNotified ? 'notified' : 'pending'}</span>
                    <span className="border-border rounded-full border px-2.5 py-1">Technical: {row.technicalClearanceStatus.replaceAll('_', ' ')}</span>
                    <span className="border-border rounded-full border px-2.5 py-1">Vehicle: {row.vehicleStatus.replaceAll('_', ' ')}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="secondary" size="sm" asChild><Link href={`/dashboard/trips/${row.tripId}`}><CarFront className="h-4 w-4" /> Trip</Link></Button>
                  <Button size="sm" asChild><Link href={`/dashboard/trips/incidents/${row.id}`}><Search className="h-4 w-4" /> Review MVA</Link></Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="border-border bg-muted/30 flex items-start gap-3 rounded-[10px] border p-4">
        <AlertTriangle className="text-status-pending-text mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-ink-600 text-xs leading-5">This workspace is the operational investigation register. Official accident PDFs remain in Operational Documents and are linked from each MVA review record rather than duplicated here.</p>
      </div>
    </div>
  );
}
