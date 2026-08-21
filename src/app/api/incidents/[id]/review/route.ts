import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripIncidents, trips } from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { refreshIncidentOperationalDocuments } from '@/lib/incidents/document-refresh';

const investigationStatuses = new Set(['pending', 'in_progress', 'awaiting_information', 'closed']);
const NON_REVIVABLE_VEHICLE_STATUSES = new Set(['written_off', 'decommissioned']);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || '');

    const requiredPermissions = action === 'insurance_update'
      ? [Permissions.INCIDENT_INSURANCE_UPDATE]
      : action === 'technical_clearance'
        ? [Permissions.INCIDENT_TECHNICAL_CLEARANCE]
        : action === 'return_vehicle_to_service'
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

      await db.execute(sql`
        WITH incident_claim AS (
          UPDATE trip_incidents ti
          SET technical_clearance_status = 'cleared',
              technical_clearance_at = ${now},
              technical_clearance_by_user_id = ${auth.session.user.id},
              updated_at = ${now}
          WHERE ti.id = ${id}::uuid
            AND ti.tenant_id = ${auth.session.tenantId}::uuid
            AND ti.trip_id = ${context.incident.tripId}::uuid
            AND NOT EXISTS (
              SELECT 1
              FROM vehicle_defects vd
              WHERE vd.vehicle_id = ${context.vehicleId}::uuid
                AND vd.is_blocking = true
                AND vd.resolved_at IS NULL
            )
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id,
            action, entity_type, entity_id, summary, after, source_channel
          )
          SELECT
            ${auth.session.tenantId}::uuid,
            ${Date.now()},
            'incident_technical_clearance',
            ${auth.session.user.id},
            'incident.technical_clearance',
            'trip_incident',
            ${id}::uuid,
            ${`${context.incident.officialNumber || id}: technical clearance granted`},
            jsonb_build_object('technicalClearanceStatus', 'cleared'),
            'web'
          FROM incident_claim
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM incident_claim) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'incident_technical_clearance_blocked'
        END AS integer) AS committed
      `);
      return NextResponse.json({ success: true });
    }

    if (action === 'close_investigation') {
      const requiresTechnicalClearance =
        context.incident.vehicleDamage ||
        context.incident.vehicleSafe === false ||
        context.incident.severity === 'critical';
      if (requiresTechnicalClearance && context.incident.technicalClearanceStatus !== 'cleared') {
        return NextResponse.json(
          { error: 'Vehicle-safety incidents require technical clearance before investigation closure.' },
          { status: 409 },
        );
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
      if (NON_REVIVABLE_VEHICLE_STATUSES.has(context.vehicleStatus)) {
        return NextResponse.json(
          { error: `A vehicle in ${context.vehicleStatus.replaceAll('_', ' ')} status cannot be returned to service from incident review.` },
          { status: 409 },
        );
      }
      if (context.vehicleStatus === 'available') return NextResponse.json({ success: true, alreadyAvailable: true });

      await db.execute(sql`
        WITH vehicle_claim AS (
          UPDATE vehicles v
          SET status = 'available',
              updated_at = ${now},
              updated_by = ${auth.session.user.id}
          WHERE v.id = ${context.vehicleId}::uuid
            AND v.tenant_id = ${auth.session.tenantId}::uuid
            AND v.status = ${context.vehicleStatus}
            AND v.status NOT IN ('written_off', 'decommissioned')
            AND EXISTS (
              SELECT 1
              FROM trip_incidents ti
              WHERE ti.id = ${id}::uuid
                AND ti.tenant_id = ${auth.session.tenantId}::uuid
                AND ti.trip_id = ${context.incident.tripId}::uuid
                AND ti.technical_clearance_status = 'cleared'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM vehicle_defects vd
              WHERE vd.vehicle_id = v.id
                AND vd.is_blocking = true
                AND vd.resolved_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1
              FROM trips active_trip
              WHERE active_trip.tenant_id = ${auth.session.tenantId}::uuid
                AND active_trip.vehicle_id = v.id
                AND active_trip.status IN ('pending', 'in_progress', 'return_due', 'return_inspection', 'closure_review')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM trip_incidents pending_incident
              INNER JOIN trips pending_trip ON pending_trip.id = pending_incident.trip_id
              WHERE pending_trip.vehicle_id = v.id
                AND pending_trip.tenant_id = ${auth.session.tenantId}::uuid
                AND pending_incident.tenant_id = ${auth.session.tenantId}::uuid
                AND (
                  pending_incident.vehicle_damage = true
                  OR pending_incident.vehicle_safe = false
                  OR pending_incident.severity = 'critical'
                )
                AND pending_incident.status <> 'resolved'
                AND pending_incident.technical_clearance_status <> 'cleared'
            )
          RETURNING id
        ),
        status_event AS (
          INSERT INTO vehicle_status_events (
            vehicle_id, previous_status, new_status, reason, changed_by_user_id,
            reference_entity_type, reference_entity_id
          )
          SELECT
            ${context.vehicleId}::uuid,
            ${context.vehicleStatus},
            'available',
            ${`Technical clearance completed for ${context.incident.officialNumber || id}`},
            ${auth.session.user.id},
            'trip_incident',
            ${id}::uuid
          FROM vehicle_claim
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id,
            action, entity_type, entity_id, summary, after, source_channel
          )
          SELECT
            ${auth.session.tenantId}::uuid,
            ${Date.now()},
            'vehicle_returned_to_service',
            ${auth.session.user.id},
            'vehicle.return_to_service',
            'trip_incident',
            ${id}::uuid,
            ${`${context.incident.officialNumber || id}: vehicle returned to available service`},
            jsonb_build_object(
              'vehicleId', ${context.vehicleId}::text,
              'previousStatus', ${context.vehicleStatus},
              'newStatus', 'available'
            ),
            'web'
          FROM status_event
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM vehicle_claim) = 1
           AND (SELECT count(*) FROM status_event) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'atomic_vehicle_return_to_service_failed'
        END AS integer) AS committed
      `);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported incident review action' }, { status: 400 });
  } catch (error) {
    console.error('[incidents/review] PATCH failed:', error);
    if (String(error).includes('incident_technical_clearance_blocked')) {
      return NextResponse.json(
        {
          error:
            'A blocking vehicle defect was recorded while technical clearance was being granted. Refresh the incident and resolve all blocking defects before clearing the vehicle.',
        },
        { status: 409 },
      );
    }
    if (String(error).includes('atomic_vehicle_return_to_service_failed')) {
      return NextResponse.json(
        {
          error:
            'The vehicle gained a blocking defect, active trip, pending technical clearance, or other restriction while return-to-service was being recorded. Refresh and review the latest vehicle state.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Incident review could not be updated' }, { status: 500 });
  }
}
