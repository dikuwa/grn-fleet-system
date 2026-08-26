import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
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

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requireAnyPermission(session, [
      Permissions.TRIP_MANAGE,
      Permissions.DRIVER_LOG_CREATE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [trip] = await db
      .select({
        trip: trips,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        allocationVehicleId: vehicleAllocations.vehicleId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        beginningOdometer: tripAuthorities.beginningOdometer,
        requestReference: transportRequests.reference,
        vehicleOdometer: vehicles.currentOdometer,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(
        and(
          eq(trips.id, id),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.userId, session.user.id),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
        ),
      )
      .limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) {
      return NextResponse.json({ error: 'Only the primary assigned driver may return this trip' }, { status: 403 });
    }
    if (!['in_progress', 'return_due'].includes(trip.trip.status)) {
      return NextResponse.json({ error: `Cannot return trip with status "${trip.trip.status}".` }, { status: 409 });
    }
    if (
      !['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(
        trip.authorityStatus,
      )
    ) {
      return NextResponse.json(
        { error: `Trip Authority cannot be returned from "${trip.authorityStatus}"` },
        { status: 409 },
      );
    }
    if (trip.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation is no longer active (${trip.allocationState})` }, { status: 409 });
    }
    if (trip.allocationVehicleId !== trip.trip.vehicleId) {
      return NextResponse.json({ error: 'The active allocation vehicle changed. Refresh the trip before recording return.' }, { status: 409 });
    }

    const minimumOdometer = Math.max(trip.beginningOdometer ?? 0, trip.vehicleOdometer ?? 0);
    if (Number(body.endingOdometer) < minimumOdometer) {
      return NextResponse.json(
        { error: `Ending odometer cannot be lower than the current verified reading (${minimumOdometer})` },
        { status: 422 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const endingOdometer = Number(body.endingOdometer);
    const fuelLevel = body.fuelLevel.trim();
    const returnLocation = body.returnLocation.trim();
    const comments = body.comments?.trim() || null;
    const auditSequence = Date.now();

    // Mid-trip vehicle replacement and trip return both mutate the active
    // allocation. Claim the exact allocation version first so one lifecycle
    // transition wins before the trip/authority/odometer evidence is frozen.
    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE va.id = ${trip.trip.allocationId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${trip.allocationVersion}
          AND va.vehicle_id = ${trip.trip.vehicleId}::uuid
          AND va.driver_employee_id = ${employee.id}::uuid
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${id}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND t.allocation_id = va.id
              AND t.vehicle_id = va.vehicle_id
              AND t.status IN ('in_progress', 'return_due')
          )
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET status = 'return_inspection', returned_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND allocation_id = ${trip.trip.allocationId}::uuid
          AND vehicle_id = ${trip.trip.vehicleId}::uuid
          AND status IN ('in_progress', 'return_due')
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING id, request_id, vehicle_id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'awaiting_arrival_inspection',
            ending_odometer = ${endingOdometer},
            data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
              'returnDeclaration',
              jsonb_build_object(
                'incidentDeclared', ${body.incidentDeclared}::boolean,
                'outstandingReceiptsDeclared', ${body.outstandingReceiptsDeclared}::boolean,
                'recordedAt', ${nowIso}::timestamptz,
                'recordedByUserId', ${session.user.id}::text,
                'source', 'internal_driver',
                'reconciledAt', NULL,
                'reconciledByUserId', NULL
              )
            ),
            version = version + 2,
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${trip.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND allocation_id = ${trip.trip.allocationId}::uuid
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
          ${trip.trip.vehicleId}::uuid,
          ${endingOdometer},
          'trip_return',
          'trip',
          ${trip.trip.id}::uuid,
          ${session.user.id},
          ${comments}
        FROM authority_claim
        RETURNING id
      ),
      vehicle_claim AS (
        UPDATE vehicles
        SET current_odometer = GREATEST(current_odometer, ${endingOdometer}), updated_at = ${nowIso}::timestamptz
        WHERE id = ${trip.trip.vehicleId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND current_odometer <= ${endingOdometer}
          AND EXISTS (SELECT 1 FROM odometer_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, actor_employee_id,
          action, entity_type, entity_id, summary, after, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'trip_returned',
          ${session.user.id},
          ${employee.id}::uuid,
          'return',
          'trip',
          ${id}::uuid,
          'Trip returned: awaiting arrival inspection',
          jsonb_build_object(
            'authorityId', ${trip.authorityId}::text,
            'allocationVersion', ${trip.allocationVersion + 1}::integer,
            'vehicleId', ${trip.trip.vehicleId}::text,
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
        ELSE 'atomic_trip_return_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM vehicle_claim)::text
      END AS integer) AS committed
    `);

    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: trip.trip.requestId,
      reference: trip.requestReference,
      stage: 'return_inspection',
      officeLabel: 'Return inspection',
    }).catch((error) => console.warn('[trips/return] Post-commit activity failed:', error));

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/return] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip, allocation, vehicle, or odometer state changed while return was being recorded. Refresh and review the latest trip.' },
      { status: 409 },
    );
  }
}
