import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleInspections, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      beginningOdometer?: number;
      passengersConfirmed?: boolean;
      fuelLevel?: string;
      latitude?: number;
      longitude?: number;
    };
    if (
      !Number.isInteger(body.beginningOdometer) ||
      Number(body.beginningOdometer) < 0 ||
      body.passengersConfirmed !== true ||
      !body.fuelLevel?.trim()
    ) {
      return NextResponse.json(
        { error: 'Beginning odometer, fuel level and actual passenger confirmation are required' },
        { status: 422 },
      );
    }
    if (
      body.latitude !== undefined &&
      (!Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90)
    ) {
      return NextResponse.json({ error: 'Latitude is invalid' }, { status: 422 });
    }
    if (
      body.longitude !== undefined &&
      (!Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180)
    ) {
      return NextResponse.json({ error: 'Longitude is invalid' }, { status: 422 });
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
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        validFrom: tripAuthorities.validFrom,
        validUntil: tripAuthorities.validUntil,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        vehicleStatus: vehicles.status,
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
    const tripRecord = trip.trip;
    if (tripRecord.status !== 'pending') {
      return NextResponse.json({ error: `Cannot start trip with status "${tripRecord.status}".` }, { status: 409 });
    }
    if (trip.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation must be confirmed before departure (${trip.allocationState})` }, { status: 409 });
    }
    if (!tripRecord.issuedAt) {
      return NextResponse.json({ error: 'Vehicle must be physically issued before the trip starts' }, { status: 409 });
    }
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for departure (${trip.authorityStatus})` }, { status: 409 });
    }
    if (trip.requestStatus !== 'vehicle_issued') {
      return NextResponse.json({ error: `Request is not ready to start (${trip.requestStatus})` }, { status: 409 });
    }
    if (trip.vehicleStatus !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available for departure (${trip.vehicleStatus})` }, { status: 409 });
    }

    const now = new Date();
    if ((trip.validFrom && now < trip.validFrom) || (trip.validUntil && now > trip.validUntil)) {
      return NextResponse.json({ error: 'Trip Authority is outside its approved validity period' }, { status: 409 });
    }

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
      return NextResponse.json({ error: 'Only the primary assigned driver may start this trip' }, { status: 403 });
    }

    const [licence] = await db
      .select({
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverProfiles)
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(driverProfiles.employeeId, employee.id),
          eq(driverLicences.isActive, true),
          eq(driverLicences.verificationStatus, 'verified'),
        ),
      )
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1);
    if (
      !licence ||
      licence.driverStatus !== 'authorised' ||
      new Date(`${licence.expiryDate}T23:59:59Z`) < (trip.validUntil ?? now)
    ) {
      return NextResponse.json(
        { error: 'Driver licence must be active, verified and valid for the entire authorised trip period' },
        { status: 409 },
      );
    }

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDefects.vehicleId, tripRecord.vehicleId),
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ),
      )
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Departure is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }

    // The latest inspection for this exact trip/current vehicle is authoritative.
    // A failed re-inspection must supersede an older pass.
    const [inspection] = await db
      .select({
        id: vehicleInspections.id,
        odometerReading: vehicleInspections.odometerReading,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
      })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, session.tenantId),
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.vehicleId, tripRecord.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(1);
    if (!inspection || inspection.status !== 'completed' || inspection.overallPass !== true) {
      return NextResponse.json(
        { error: 'The latest pre-departure inspection for the currently allocated vehicle must be completed and passed' },
        { status: 409 },
      );
    }
    const minimumOdometer = Math.max(inspection.odometerReading ?? 0, trip.vehicleOdometer ?? 0);
    if (Number(body.beginningOdometer) < minimumOdometer) {
      return NextResponse.json(
        { error: `Beginning odometer cannot be lower than the current verified reading (${minimumOdometer})` },
        { status: 422 },
      );
    }

    const location =
      body.latitude != null && body.longitude != null
        ? JSON.stringify({ latitude: body.latitude, longitude: body.longitude })
        : null;
    const fuelLevel = body.fuelLevel.trim();
    const auditSequence = Date.now();

    // Claim departure only if every safety/lifecycle prerequisite is still true
    // at mutation time. This closes the window where a new blocking defect,
    // failed re-inspection, reassignment or status change could occur after the
    // initial validation but before the trip transitioned to in_progress.
    await db.execute(sql`
      WITH trip_claim AS (
        UPDATE trips
        SET status = 'in_progress', started_at = ${now}, updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NOT NULL
          AND vehicle_id = ${tripRecord.vehicleId}::uuid
          AND allocation_id = ${tripRecord.allocationId}::uuid
          AND EXISTS (
            SELECT 1
            FROM vehicle_allocations va
            WHERE va.id = trips.allocation_id
              AND va.vehicle_id = trips.vehicle_id
              AND va.driver_employee_id = ${employee.id}::uuid
              AND va.state = 'confirmed'
          )
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = 'vehicle_issued'
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.trip_id = trips.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'ready_for_departure'
              AND (ta.valid_from IS NULL OR ta.valid_from <= ${now})
              AND (ta.valid_until IS NULL OR ta.valid_until >= ${now})
          )
          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = trips.vehicle_id
              AND v.tenant_id = ${session.tenantId}::uuid
              AND v.status = 'available'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects vd
            WHERE vd.vehicle_id = trips.vehicle_id
              AND vd.is_blocking = true
              AND vd.resolved_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM vehicle_inspections vi
            WHERE vi.id = (
              SELECT latest.id
              FROM vehicle_inspections latest
              WHERE latest.tenant_id = ${session.tenantId}::uuid
                AND latest.trip_id = trips.id
                AND latest.vehicle_id = trips.vehicle_id
                AND latest.type = 'departure'
              ORDER BY latest.created_at DESC
              LIMIT 1
            )
              AND vi.status = 'completed'
              AND vi.overall_pass = true
          )
        RETURNING id, request_id, vehicle_id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'in_progress',
            beginning_odometer = ${Number(body.beginningOdometer)},
            version = version + 1,
            updated_at = ${now}
        WHERE id = ${trip.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'ready_for_departure'
          AND EXISTS (SELECT 1 FROM trip_claim)
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'in_progress', updated_at = ${now}
        WHERE id = ${tripRecord.requestId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'vehicle_issued'
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      ),
      vehicle_claim AS (
        UPDATE vehicles
        SET status = 'allocated', updated_at = ${now}
        WHERE id = ${tripRecord.vehicleId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'available'
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      status_event AS (
        INSERT INTO vehicle_status_events (
          vehicle_id, previous_status, new_status, reason, changed_by_user_id,
          reference_entity_type, reference_entity_id
        )
        SELECT
          ${tripRecord.vehicleId}::uuid,
          'available',
          'allocated',
          ${`Trip started: ${tripRecord.id.slice(0, 8)}...`},
          ${session.user.id},
          'trip',
          ${tripRecord.id}::uuid
        FROM vehicle_claim
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
          'trip_started',
          ${session.user.id},
          ${employee.id}::uuid,
          'start',
          'trip',
          ${id}::uuid,
          ${`Trip started: vehicle ${tripRecord.vehicleId.slice(0, 8)}`},
          jsonb_build_object(
            'authorityId', ${trip.authorityId}::text,
            'beginningOdometer', ${Number(body.beginningOdometer)}::integer,
            'fuelLevel', ${fuelLevel}::text,
            'passengersConfirmed', true,
            'location', CASE WHEN ${location}::text IS NULL THEN NULL ELSE ${location}::jsonb END
          ),
          'web'
        FROM status_event
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM vehicle_claim) = 1
         AND (SELECT count(*) FROM status_event) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_trip_start_failed_' || (SELECT count(*) FROM trip_claim)::text
      END AS integer) AS committed
    `);

    if (tripRecord.allocationId) {
      await onTripIssued(tripRecord.allocationId, session.tenantId, session.user.id).catch((error) =>
        console.warn('[trips/start] Post-commit document generation failed:', error),
      );
    }
    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: tripRecord.requestId,
      reference: trip.requestReference,
      stage: 'started',
      officeLabel: 'Assigned driver',
    }).catch((error) => console.warn('[trips/start] Post-commit activity failed:', error));

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/start] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip state changed concurrently or the trip could not be started. Refresh and try again.' },
      { status: 409 },
    );
  }
}
