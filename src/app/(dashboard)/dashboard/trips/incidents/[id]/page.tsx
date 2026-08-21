import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AlertTriangle, ArrowLeft, CarFront, FileText, ShieldCheck } from 'lucide-react';
import { getDb } from '@/db';
import { tripIncidents, trips } from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { generatedDocuments } from '@/db/schema/documents';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getServerSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';
import { IncidentReviewActions } from './incident-review-actions';

export default async function MvaReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) notFound();
  const { id } = await params;
  const db = getDb();
  const permissions = await getSessionPermissions(session);

  const [row] = await db
    .select({
      incident: tripIncidents,
      tripStatus: trips.status,
      vehicleId: vehicles.id,
      vehicleLicence: vehicles.licenceNumber,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleStatus: vehicles.status,
      currentOdometer: vehicles.currentOdometer,
      requestReference: transportRequests.reference,
      requestPurpose: transportRequests.purpose,
    })
    .from(tripIncidents)
    .innerJoin(trips, and(eq(trips.id, tripIncidents.tripId), eq(trips.tenantId, session.tenantId)))
    .innerJoin(vehicles, and(eq(vehicles.id, trips.vehicleId), eq(vehicles.tenantId, session.tenantId)))
    .leftJoin(transportRequests, and(eq(transportRequests.id, trips.requestId), eq(transportRequests.tenantId, session.tenantId)))
    .where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, session.tenantId)))
    .limit(1);
  if (!row) notFound();

  const [documents, blockingDefects] = await Promise.all([
    db
      .select({ id: generatedDocuments.id, documentType: generatedDocuments.documentType, status: generatedDocuments.status, createdAt: generatedDocuments.createdAt })
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.tenantId, session.tenantId), eq(generatedDocuments.entityType, 'trip_incident'), eq(generatedDocuments.entityId, id)))
      .orderBy(desc(generatedDocuments.createdAt)),
    db
      .select({ id: vehicleDefects.id, severity: vehicleDefects.severity, description: vehicleDefects.description, createdAt: vehicleDefects.createdAt })
      .from(vehicleDefects)
      .where(and(eq(vehicleDefects.vehicleId, row.vehicleId), eq(vehicleDefects.isBlocking, true), isNull(vehicleDefects.resolvedAt)))
      .orderBy(desc(vehicleDefects.createdAt)),
  ]);

  const canInvestigate = permissions.includes(Permissions.INCIDENT_INVESTIGATE) || permissions.includes(Permissions.TRIP_INCIDENT_MANAGE);
  const canInsurance = permissions.includes(Permissions.INCIDENT_INSURANCE_UPDATE);
  const canGrantTechnicalClearance = permissions.includes(Permissions.INCIDENT_TECHNICAL_CLEARANCE);
  const canReturnVehicleToService = canGrantTechnicalClearance || permissions.includes(Permissions.MAINTENANCE_MANAGE);
  const canClose = permissions.includes(Permissions.INCIDENT_CLOSE_INVESTIGATION);
  const readAllowed = canInvestigate || canInsurance || canReturnVehicleToService || canClose || permissions.includes(Permissions.AUDIT_READ);
  if (!readAllowed) notFound();

  const incident = row.incident;
  const requiresTechnicalClearance =
    incident.vehicleDamage || incident.vehicleSafe === false || incident.severity === 'critical';
  const thirdPartyDetails = incident.thirdPartyDetails as Record<string, unknown> | null;
  const witnessStatements = Array.isArray(incident.witnessStatements) ? incident.witnessStatements : [];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Trips', href: '/dashboard/trips' }, { label: 'MVA & Incidents', href: '/dashboard/trips/incidents' }, { label: incident.officialNumber || 'MVA review' }]} />
      <PageHeader title={incident.officialNumber || 'MVA Review'} description={`${incident.incidentType.replaceAll('_', ' ')} · ${formatDateTime(incident.occurredAt)}`}>
        <Button variant="secondary" size="sm" asChild><Link href="/dashboard/trips/incidents"><ArrowLeft className="h-4 w-4" /> Back to workspace</Link></Button>
        <Button variant="secondary" size="sm" asChild><Link href={`/dashboard/trips/${incident.tripId}`}><CarFront className="h-4 w-4" /> Open trip</Link></Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Incident record</CardTitle>
                <Badge variant={incident.severity === 'critical' || incident.severity === 'serious' ? 'error' : 'pending'} size="sm">{incident.severity}</Badge>
                <Badge variant={incident.investigationStatus === 'closed' ? 'success' : 'info'} size="sm">{incident.investigationStatus.replaceAll('_', ' ')}</Badge>
                {incident.detailsRequired && <Badge variant="warning" size="sm">Additional details required</Badge>}
                {requiresTechnicalClearance && incident.technicalClearanceStatus !== 'cleared' && <Badge variant="warning" size="sm">Vehicle safety hold</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-ink-800 text-sm leading-6">{incident.description}</p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-ink-500 text-xs">Location</dt><dd className="text-ink-950 mt-0.5">{incident.location || 'Not recorded'}</dd></div>
                <div><dt className="text-ink-500 text-xs">Odometer</dt><dd className="text-ink-950 mt-0.5">{incident.odometerReading == null ? 'Not recorded' : `${incident.odometerReading.toLocaleString()} km`}</dd></div>
                <div><dt className="text-ink-500 text-xs">Injuries</dt><dd className="text-ink-950 mt-0.5">{incident.injuries ? `${incident.numberInjured} recorded` : 'No'}</dd></div>
                <div><dt className="text-ink-500 text-xs">Vehicle damage</dt><dd className="text-ink-950 mt-0.5">{incident.vehicleDamage ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-ink-500 text-xs">Vehicle safe</dt><dd className="text-ink-950 mt-0.5">{incident.vehicleSafe === false ? 'No' : incident.vehicleSafe === true ? 'Yes' : 'Not recorded'}</dd></div>
                <div><dt className="text-ink-500 text-xs">Third party involved</dt><dd className="text-ink-950 mt-0.5">{incident.thirdPartyInvolvement ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-ink-500 text-xs">Continuation</dt><dd className="text-ink-950 mt-0.5 capitalize">{incident.continuationState.replaceAll('_', ' ')}</dd></div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vehicle & trip context</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-ink-500 text-xs">Vehicle</dt><dd className="text-ink-950 mt-0.5">{row.vehicleLicence} · {row.vehicleMake} {row.vehicleModel}</dd></div>
                <div><dt className="text-ink-500 text-xs">Vehicle status</dt><dd className="mt-0.5"><Badge variant={row.vehicleStatus === 'available' ? 'success' : row.vehicleStatus === 'maintenance' ? 'warning' : 'info'} size="sm">{row.vehicleStatus.replaceAll('_', ' ')}</Badge></dd></div>
                <div><dt className="text-ink-500 text-xs">Trip status</dt><dd className="text-ink-950 mt-0.5 capitalize">{row.tripStatus.replaceAll('_', ' ')}</dd></div>
                <div><dt className="text-ink-500 text-xs">Request</dt><dd className="text-ink-950 mt-0.5">{row.requestReference || 'Not recorded'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-ink-500 text-xs">Purpose</dt><dd className="text-ink-950 mt-0.5">{row.requestPurpose || 'Not recorded'}</dd></div>
              </dl>
            </CardContent>
          </Card>

          {(incident.thirdPartyInvolvement || witnessStatements.length > 0) && (
            <Card>
              <CardHeader><CardTitle>Third-party & witness information</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {thirdPartyDetails ? <pre className="border-border bg-muted/30 overflow-x-auto rounded-[8px] border p-3 text-xs text-ink-700">{JSON.stringify(thirdPartyDetails, null, 2)}</pre> : <p className="text-ink-500">Third-party details have not yet been captured.</p>}
                {witnessStatements.length > 0 ? witnessStatements.map((statement, index) => <div key={index} className="border-border rounded-[8px] border p-3 text-xs text-ink-700">{JSON.stringify(statement)}</div>) : null}
              </CardContent>
            </Card>
          )}

          <IncidentReviewActions
            incidentId={incident.id}
            initial={{
              investigationStatus: incident.investigationStatus,
              investigationNotes: incident.investigationNotes,
              administratorResponse: incident.administratorResponse,
              policeReference: incident.policeReference,
              policeReportFiled: incident.policeReportFiled,
              insuranceClaimReference: incident.insuranceClaimReference,
              insuranceNotified: incident.insuranceNotified,
              technicalClearanceStatus: incident.technicalClearanceStatus,
              investigationClosedAt: incident.investigationClosedAt?.toISOString() || null,
            }}
            vehicleStatus={row.vehicleStatus}
            requiresTechnicalClearance={requiresTechnicalClearance}
            canInvestigate={canInvestigate}
            canInsurance={canInsurance}
            canGrantTechnicalClearance={canGrantTechnicalClearance}
            canReturnVehicleToService={canReturnVehicleToService}
            canClose={canClose}
          />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Follow-up readiness</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3"><span className="text-ink-500">Police report</span><span className="text-ink-950 font-medium">{incident.policeReportFiled ? 'Filed' : 'Pending'}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="text-ink-500">Insurance</span><span className="text-ink-950 font-medium">{incident.insuranceNotified ? 'Notified' : 'Pending'}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="text-ink-500">Technical clearance</span><span className="text-ink-950 font-medium capitalize">{incident.technicalClearanceStatus.replaceAll('_', ' ')}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="text-ink-500">Blocking defects</span><span className={blockingDefects.length ? 'text-status-error-text font-medium' : 'text-status-success-text font-medium'}>{blockingDefects.length}</span></div>
            </CardContent>
          </Card>

          {blockingDefects.length > 0 && (
            <Card className="border-status-error-text/30">
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-error-text" /> Blocking vehicle defects</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {blockingDefects.map((defect) => <div key={defect.id} className="border-border rounded-[8px] border p-3"><p className="text-ink-950 text-xs font-medium capitalize">{defect.severity}</p><p className="text-ink-600 mt-1 text-xs">{defect.description}</p></div>)}
                <Button variant="secondary" size="sm" asChild><Link href={`/dashboard/fleet/${row.vehicleId}?tab=defects`}>Open vehicle defects</Link></Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Official documents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {documents.length === 0 ? <p className="text-ink-500 text-xs">No official MVA document has been generated yet.</p> : documents.map((document) => (
                <Link key={document.id} href={`/dashboard/documents/${document.id}`} className="focus-ring border-border hover:bg-muted/40 flex items-center justify-between gap-3 rounded-[8px] border p-3 transition-colors motion-reduce:transition-none">
                  <span className="text-ink-950 text-xs font-medium">{document.documentType.replaceAll('_', ' ')}</span>
                  <Badge variant={document.status === 'issued' ? 'success' : 'pending'} size="sm">{document.status}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>

          <div className="border-brand-200 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-950/20 rounded-[10px] border p-4">
            <div className="flex items-start gap-3"><ShieldCheck className="text-brand-700 mt-0.5 h-5 w-5 shrink-0" /><p className="text-ink-700 text-xs leading-5">A vehicle cannot be returned to available service from this incident until technical clearance is granted where required, all blocking defects are resolved, no active trip still owns the vehicle, and no other unresolved vehicle-safety incident remains uncleared.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
