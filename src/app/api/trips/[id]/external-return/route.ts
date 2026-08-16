import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Transport Office records the physical return of an accepted external-driver
 * trip. External drivers are not tenant users, so they deliberately do not use
 * the employee Driver workspace or inherit the employee-only /return endpoint.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const actionCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      endingOdometer?: number;
      fuelLevel?: string;
      returnLocation?: string;
      incidentDeclared?: boolean;
      outstandingReceiptsDeclared?: boolean;
      comments?: string;
    };
    if (
      !Number.isInteger(body.endingOdometer) ||
      Number(body.endingOdometer) < 0 ||
      !body.fuelLevel?.trim() ||
      !body.returnLocation?.trim() ||
      typeof body.incidentDeclared !== 'boolean' ||
      typeof body.outstandingReceiptsDeclared !== 'boolean'
    ) {
      return NextResponse.json(
        {
          error:
            'Ending odometer, fuel level, return location, incident and outstanding-receipt declarations are required',
        },
        { status: 422 },
      );
    }
    if (body.returnLocation.trim().length > 240 || (body.comments?.length ?? 0) > 2000) {
      return NextResponse.json({ error: 'Return location or comments are too long' }, { status: 422 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignmentId: externalDriverAssignments.id,
        externalPartyId: externalDriverAssignments.externalPartyId,
        assignmentState: externalDriverAssignments.state,
        assignmentIssueId: externalDriverAssignments.issueId,
        allocationId: vehicleAllocations.id,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        allocationVehicleId: vehicleAllocations.vehicleId,
        tripStatus: trips.status,
        tripIssuedAt: trips.issuedAt,
        tripStartedAt: trips.startedAt,
        requestId: trips.requestId,
        requestReference: transportRequests.reference,
        requestExternalDriverPartyId: transportRequests.assignedDriverExternalPartyId,
        vehicleId: trips.vehicleId,
        vehicleOdometer: vehicles.currentOdometer,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        beginningOdometer: tripAuthorities.beginningOdometer,
      })
      .from(externalDriverAssignments)
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(
        and(
          eq(externalDriverAssignments.tripId, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(externalDriverAssignments.state, 'accepted'),
          eq(trips.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(vehicles.tenantId, tenantId),
          eq(tripAuthorities.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!record) return NextResponse.json({ error: 'Active external-driver trip not found' }, { status: 404 });
    if (!record.assignmentIssueId || !record.tripIssuedAt || !record.tripStartedAt) {
      return NextResponse.json(
        { error: 'The external-driver trip has not completed physical issue and departure.' },
        { status: 409 },
      );
    }
    if (record.requestExternalDriverPartyId !== record.externalPartyId) {
      return NextResponse.json({ error: 'The accepted external driver is no longer the request’s assigned driver.' }, { status: 409 });
    }
    if (!['in_progress', 'return_due'].includes(record.tripStatus)) {
      return NextResponse.json({ error: `Cannot return trip with status "${record.tripStatus}".` }, { status: 409 });
    }
    if (
      !['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(
        record.authorityStatus,
      )
    ) {
      return NextResponse.json(
        { error: `Trip Authority cannot be returned from "${record.authorityStatus}".` },
        { status: 409 },
      );
    }
    if (record.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation is no longer active (${record.allocationState}).` }, { status: 409 });
    }
    if (record.allocationVehicleId !== record.vehicleId) {
      return NextResponse.json({ error: 'The active allocation vehicle changed. Refresh before recording return.' }, { status: 409 });
    }

    const endingOdometer = Number(body.endingOdometer);
    const minimumOdometer = Math.max(record.beginningOdometer ?? 0, record.vehicleOdometer ?? 0);
    if (endingOdometer < minimumOdometer) {
      return NextResponse.json(
        { error: `Ending odometer cannot be lower than the current verified reading (${minimumOdometer})` },
        { status: 422 },
      );
    }

    const now = new Date();
    const fuelLevel = body.fuelLevel.trim();
    const returnLocation = body.returnLocation.trim();
    const comments = body.comments?.trim() || null;
    const auditSequence = Date.now();

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${now}
        WHERE va.id = ${record.allocationId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${record.allocationVersion}
          AND va.vehicle_id = ${record.vehicleId}::uuid
          AND va.driver_employee_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${id}::uuid
              AND t.tenant_id = ${tenantId}::uuid
              AND t.allocation_id = va.id
              AND t.vehicle_id = va.vehicle_id
              AND t.status IN ('in_progress', 'return_due')
          )
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET status = 'return_inspection', returned_at = ${now}, updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND allocation_id = ${record.allocationId}::uuid
          AND vehicle_id = ${record.vehicleId}::uuid
          AND status IN ('in_progress', 'return_due')
          AND started_at IS NOT NULL
          AND issued_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM external_driver_assignments eda
            WHERE eda.id = ${record.assignmentId}::uuid
              AND eda.tenant_id = ${tenantId}::uuid
              AND eda.trip_id = trips.id
              AND eda.allocation_id = trips.allocation_id
              AND eda.external_party_id = ${record.externalPartyId}::uuid
              AND eda.state = 'accepted'
              AND eda.issue_id = ${record.assignmentIssueId}::uuid
          )
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${tenantId}::uuid
              AND tr.assigned_driver_external_party_id = ${record.externalPartyId}::uuid
          )
        RETURNING id, request_id, vehicle_id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'awaiting_arrival_inspection',
            ending_odometer = ${endingOdometer},
            version = version + 2,
            updated_at = ${now}
        WHERE id = ${record.authorityId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND allocation_id = ${record.allocationId}::uuid
          AND status IN ('in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported')
          AND EXISTS (SELECT 1 FROM trip_claim)
        RETURNING id
      ),
      odometer_insert AS (
        INSERT INTO vehicle_odometer_events (
          vehicle_id, odometer_value, source, source_entity_type, source_entity_id,
          recorded_by_user_id, notes
        )
        SELECT
          ${record.vehicleId}::uuid,
          ${endingOdometer},
          'trip_return',
          'trip',
          ${id}::uuid,
          ${session.user.id},
          ${comments}
        FROM authority_claim
        RETURNING id
      ),
      vehicle_claim AS (
        UPDATE vehicles
        SET current_odometer = GREATEST(current_odometer, ${endingOdometer}), updated_at = ${now}
        WHERE id = ${record.vehicleId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND current_odometer <= ${endingOdometer}
          AND EXISTS (SELECT 1 FROM odometer_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, after, source_channel
        )
        SELECT
          ${tenantId}::uuid,
          ${auditSequence},
          'trip_returned_external_driver',
          ${session.user.id},
          'external_return',
          'trip',
          ${id}::uuid,
          ${`Transport Office recorded return of external-driver trip for ${record.requestReference}`},
          jsonb_build_object(
            'externalDriverAssignmentId', ${record.assignmentId}::text,
            'externalDriverPartyId', ${record.externalPartyId}::text,
            'authorityId', ${record.authorityId}::text,
            'allocationVersion', ${record.allocationVersion + 1}::integer,
            'vehicleId', ${record.vehicleId}::text,
            'endingOdometer', ${endingOdometer}::integer,
            'fuelLevel', ${fuelLevel}::text,
            'returnLocation', ${returnLocation}::text,
            'incidentDeclared', ${body.incidentDeclared}::boolean,
            'outstandingReceiptsDeclared', ${body.outstandingReceiptsDeclared}::boolean
          ),
          'web'
        FROM vehicle_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM odometer_insert) = 1
         AND (SELECT count(*) FROM vehicle_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_external_trip_return_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM vehicle_claim)::text
      END AS integer) AS committed
    `);

    await recordTenantRequestActivity({
      tenantId,
      requestId: record.requestId,
      reference: record.requestReference,
      stage: 'return_inspection',
      officeLabel: 'Transport office · external driver return',
    }).catch((error) => console.warn('[trips/external-return] Post-commit activity failed:', error));

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)))
      .limit(1);
    return NextResponse.json({ trip: updatedTrip, externalDriverAssignmentId: record.assignmentId });
  } catch (error) {
    console.error('[trips/external-return] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip, allocation, external-driver, vehicle, or odometer state changed while return was being recorded. Refresh and review the latest trip.' },
      { status: 409 },
    );
  }
}
