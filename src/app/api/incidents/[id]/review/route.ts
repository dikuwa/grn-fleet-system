import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripIncidents, trips } from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { refreshIncidentOperationalDocuments } from '@/lib/incidents/document-refresh';

const investigationStatuses = new Set(['pending', 'in_progress', 'awaiting_information', 'closed']);
const activeTripStatuses = ['pending', 'in_progress', 'return_due', 'return_inspection', 'closure_review'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || '');

    const requiredPermissions = action === 'insurance_update'
      ? [Permissions.INCIDENT_INSURANCE_UPDATE]
      : action === 'technical_clearance' || action === 'return_vehicle_to_service'
        ? [Permissions.INCIDENT_TECHNICAL_CLEARANCE, Permissions.MAINTENANCE_MANAGE]
        : action === 'close_investigation'
          ? [Permissions.INCIDENT_CLOSE_INVESTIGATION]
          : [Permissions.INCIDENT_INVESTIGATE, Permissions.TRIP_INCIDENT_MANAGE];
    const permission = await requireAnyPermission(auth.session, requiredPermissions);
    if (permission instanceof NextResponse) return permission;

    const db = getDb();
    const [context] = await db
      .select({ incident: tripIncidents, vehicleId: trips.vehicleId, tripStatus: trips.status, vehicleStatus: vehicles.status })
      .from(tripIncidents)
      .innerJoin(trips, and(eq(trips.id, tripIncidents.tripId), eq(trips.tenantId, auth.session.tenantId)))
      .innerJoin(vehicles, and(eq(vehicles.id, trips.vehicleId), eq(vehicles.tenantId, auth.session.tenantId)))
      .where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, auth.session.tenantId)))
      .limit(1);

    if (!context) return NextResponse.json({ error: 'Incident record not found' }, { status: 404 });

    const now = new Date();
    const commonAudit = {
      tenantId: auth.session.tenantId,
      tenantSequence: Date.now(),
      actorUserId: auth.session.user.id,
      entityType: 'trip_incident',
      entityId: id,
      sourceChannel: 'web' as const,
    };

    if (action === 'investigation_update') {
      const investigationStatus = String(body.investigationStatus || context.incident.investigationStatus);
      if (!investigationStatuses.has(investigationStatus)) {
        return NextResponse.json({ error: 'Select a valid investigation status' }, { status: 422 });
      }
      await runAtomicMutations((tx) => [
        tx.update(tripIncidents).set({
          investigationStatus,
          investigationNotes: body.investigationNotes == null ? context.incident.investigationNotes : String(body.investigationNotes).trim() || null,
          policeReference: body.policeReference == null ? context.incident.policeReference : String(body.policeReference).trim() || null,
          policeReportFiled: typeof body.policeReportFiled === 'boolean' ? body.policeReportFiled : context.incident.policeReportFiled,
          administratorResponse: body.administratorResponse == null ? context.incident.administratorResponse : String(body.administratorResponse).trim() || null,
          status: investigationStatus === 'closed' ? context.incident.status : 'under_review',
          updatedAt: now,
        }).where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, auth.session.tenantId))),
        tx.insert(auditEvents).values({
          ...commonAudit,
          eventType: 'incident_investigation_updated',
          action: 'incident.investigation.update',
          summary: `${context.incident.officialNumber || id}: investigation updated to ${investigationStatus.replaceAll('_', ' ')}`,
          after: { investigationStatus, policeReportFiled: body.policeReportFiled, policeReference: body.policeReference },
        }),
      ]);
      await refreshIncidentOperationalDocuments({
        tenantId: auth.session.tenantId,
        incidentId: id,
        tripId: context.incident.tripId,
        actorUserId: auth.session.user.id,
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'insurance_update') {
      const insuranceNotified = body.insuranceNotified === true;
      await runAtomicMutations((tx) => [
        tx.update(tripIncidents).set({
          insuranceClaimReference: body.insuranceClaimReference ? String(body.insuranceClaimReference).trim() : null,
          insuranceNotified,
          insuranceNotifiedAt: insuranceNotified ? context.incident.insuranceNotifiedAt || now : null,
          updatedAt: now,
        }).where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, auth.session.tenantId))),
        tx.insert(auditEvents).values({
          ...commonAudit,
          eventType: 'incident_insurance_updated',
          action: 'incident.insurance.update',
          summary: `${context.incident.officialNumber || id}: insurance details updated`,
          after: { insuranceNotified, insuranceClaimReference: body.insuranceClaimReference || null },
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    if (action === 'technical_clearance') {
      const unresolved = await db
        .select({ id: vehicleDefects.id })
        .from(vehicleDefects)
        .where(and(eq(vehicleDefects.vehicleId, context.vehicleId), eq(vehicleDefects.isBlocking, true), isNull(vehicleDefects.resolvedAt)))
        .limit(1);
      if (unresolved.length) {
        return NextResponse.json({ error: 'Resolve all blocking vehicle defects before technical clearance.' }, { status: 409 });
      }
      await runAtomicMutations((tx) => [
        tx.update(tripIncidents).set({
          technicalClearanceStatus: 'cleared',
          technicalClearanceAt: now,
          technicalClearanceByUserId: auth.session.user.id,
          updatedAt: now,
        }).where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, auth.session.tenantId))),
        tx.insert(auditEvents).values({
          ...commonAudit,
          eventType: 'incident_technical_clearance',
          action: 'incident.technical_clearance',
          summary: `${context.incident.officialNumber || id}: technical clearance granted`,
          after: { technicalClearanceStatus: 'cleared' },
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    if (action === 'close_investigation') {
      if (context.incident.vehicleDamage && context.incident.technicalClearanceStatus !== 'cleared') {
        return NextResponse.json({ error: 'Vehicle-damage investigations require technical clearance before closure.' }, { status: 409 });
      }
      await runAtomicMutations((tx) => [
        tx.update(tripIncidents).set({
          investigationStatus: 'closed',
          investigationClosedAt: now,
          status: 'resolved',
          detailsRequired: false,
          updatedAt: now,
        }).where(and(eq(tripIncidents.id, id), eq(tripIncidents.tenantId, auth.session.tenantId))),
        tx.insert(auditEvents).values({
          ...commonAudit,
          eventType: 'incident_investigation_closed',
          action: 'incident.investigation.close',
          summary: `${context.incident.officialNumber || id}: investigation closed`,
          after: { investigationStatus: 'closed', status: 'resolved' },
        }),
      ]);
      await refreshIncidentOperationalDocuments({
        tenantId: auth.session.tenantId,
        incidentId: id,
        tripId: context.incident.tripId,
        actorUserId: auth.session.user.id,
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'return_vehicle_to_service') {
      if (context.incident.technicalClearanceStatus !== 'cleared') {
        return NextResponse.json({ error: 'Technical clearance is required before returning the vehicle to service.' }, { status: 409 });
      }
      const [blocking, activeTrip] = await Promise.all([
        db.select({ id: vehicleDefects.id }).from(vehicleDefects).where(and(eq(vehicleDefects.vehicleId, context.vehicleId), eq(vehicleDefects.isBlocking, true), isNull(vehicleDefects.resolvedAt))).limit(1),
        db.select({ id: trips.id }).from(trips).where(and(eq(trips.tenantId, auth.session.tenantId), eq(trips.vehicleId, context.vehicleId), inArray(trips.status, activeTripStatuses))).limit(1),
      ]);
      if (blocking.length) return NextResponse.json({ error: 'The vehicle still has an unresolved blocking defect.' }, { status: 409 });
      if (activeTrip.length) return NextResponse.json({ error: 'The vehicle still belongs to an active trip and cannot be marked available yet.' }, { status: 409 });
      if (context.vehicleStatus === 'available') return NextResponse.json({ success: true, alreadyAvailable: true });

      await runAtomicMutations((tx) => [
        tx.update(vehicles).set({ status: 'available', updatedAt: now, updatedBy: auth.session.user.id }).where(and(eq(vehicles.id, context.vehicleId), eq(vehicles.tenantId, auth.session.tenantId))),
        tx.insert(vehicleStatusEvents).values({
          vehicleId: context.vehicleId,
          previousStatus: context.vehicleStatus,
          newStatus: 'available',
          reason: `Technical clearance completed for ${context.incident.officialNumber || id}`,
          changedByUserId: auth.session.user.id,
          referenceEntityType: 'trip_incident',
          referenceEntityId: id,
        }),
        tx.insert(auditEvents).values({
          ...commonAudit,
          eventType: 'vehicle_returned_to_service',
          action: 'vehicle.return_to_service',
          summary: `${context.incident.officialNumber || id}: vehicle returned to available service`,
          after: { vehicleId: context.vehicleId, previousStatus: context.vehicleStatus, newStatus: 'available' },
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported incident review action' }, { status: 400 });
  } catch (error) {
    console.error('[incidents/review] PATCH failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Incident review could not be updated' }, { status: 500 });
  }
}
