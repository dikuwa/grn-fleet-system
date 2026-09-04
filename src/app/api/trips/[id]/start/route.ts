import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripIssues,
  trips,
  vehicleInspections,
  vehicleAllocations,
} from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import {
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Trip ID is invalid' }, { status: 400 });
    }

    const db = getDb();
    const [trip] = await db
      .select({
        trip: trips,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        validFrom: tripAuthorities.validFrom,
        validUntil: tripAuthorities.validUntil,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        vehicleStatus: vehicles.status,
        vehicleOdometer: vehicles.currentOdometer,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
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
      return NextResponse.json({ error: `Cannot start trip with status \"${tripRecord.status}\".` }, { status: 409 });
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
    const nowIso = now.toISOString();
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
    if (
      !tripRecord.driverAcknowledgedAt ||
      tripRecord.driverAcknowledgedByEmployeeId !== employee.id
    ) {
      return NextResponse.json(
        {
          error:
            'The current assigned driver must acknowledge this trip before departure. Reassigned drivers cannot inherit another driver’s acknowledgement.',
        },
        { status: 409 },
      );
    }

    const [licence] = await db
      .select({
        licenceId: driverLicences.id,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        profileId: driverProfiles.id,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverProfiles)
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(driverProfiles.employeeId, employee.id),
          eq(driverLicences.isActive, true),
          eq(driverLicences.isVerified, true),
          eq(driverLicences.verificationStatus, 'verified'),
        ),
      )
      .orderBy(desc(driverLicences.version))
      .limit(1);
    if (
      !licence ||
      licence.driverStatus !== 'authorised' ||
      new Date(`${licence.expiryDate}T23:59:59.999Z`) < (trip.validUntil ?? now)
    ) {
      return NextResponse.json(
        { error: 'Driver licence must be active, verified and valid for the entire authorised trip period' },
        { status: 409 },
      );
    }
    if (
      trip.requiredLicenceClass &&
      !namibiaLicenceClassCovers(licence.licenceClass, trip.requiredLicenceClass)
    ) {
      return NextResponse.json(
        {
          error: `Driver licence class ${licence.licenceClass} does not cover the current vehicle requirement ${trip.requiredLicenceClass}`,
        },
        { status: 409 },
      );
    }

    let professionalAuthorisationId: string | null = null;
    if (trip.professionalAuthorisationRequired) {
      const [professionalAuthorisation] = await db
        .select({ id: driverProfessionalAuthorisations.id })
        .from(driverProfessionalAuthorisations)
        .where(
          and(
            eq(driverProfessionalAuthorisations.driverProfileId, licence.profileId),
            eq(driverProfessionalAuthorisations.isVerified, true),
            sql`${driverProfessionalAuthorisations.expiryDate} >= ${(trip.validUntil ?? now).toISOString().slice(0, 10)}`,
            sql`(${driverProfessionalAuthorisations.validFrom} IS NULL OR ${driverProfessionalAuthorisations.validFrom} <= ${now.toISOString().slice(0, 10)})`,
          ),
        )
        .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
        .limit(1);
      if (!professionalAuthorisation) {
        return NextResponse.json(
          {
            error:
              'This vehicle requires verified professional driving authorisation valid for the authorised trip period.',
          },
          { status: 409 },
        );
      }
      professionalAuthorisationId = professionalAuthorisation.id;
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

    const [[inspection], [issue]] = await Promise.all([
      db
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
        .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
        .limit(1),
      db
        .select({ id: tripIssues.id, issueOdometer: tripIssues.issueOdometer })
        .from(tripIssues)
        .where(and(eq(tripIssues.tripId, id), eq(tripIssues.allocationId, tripRecord.allocationId)))
        .orderBy(desc(tripIssues.issuedAt), desc(tripIssues.id))
        .limit(1),
    ]);
    if (!inspection || inspection.status !== 'completed' || inspection.overallPass !== true) {
      return NextResponse.json(
        { error: 'The latest pre-departure inspection for the currently allocated vehicle must be completed and passed' },
        { status: 409 },
      );
    }
    if (!issue) {
      return NextResponse.json({ error: 'The current physical vehicle issue record is missing' }, { status: 409 });
    }

    const beginningOdometer = Number(body.beginningOdometer);
    const minimumOdometer = Math.max(
      issue.issueOdometer ?? 0,
      inspection.odometerReading ?? 0,
      trip.vehicleOdometer ?? 0,
    );
    if (beginningOdometer < minimumOdometer) {
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
    const requiredThroughDate = (trip.validUntil ?? now).toISOString().slice(0, 10);
    const today = nowIso.slice(0, 10);

    // Allocation is the first lifecycle claim, matching replacement,
    // cancellation and physical issue. This prevents a replacement from
    // crossing the actual employee-driver departure boundary with stale state.
    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE va.id = ${tripRecord.allocationId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${trip.allocationVersion}
          AND va.vehicle_id = ${tripRecord.vehicleId}::uuid
          AND va.driver_employee_id = ${employee.id}::uuid
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${id}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND t.allocation_id = va.id
              AND t.vehicle_id = va.vehicle_id
              AND t.status = 'pending'
              AND t.issued_at IS NOT NULL
              AND t.driver_acknowledged_at IS NOT NULL
              AND t.driver_acknowledged_by_employee_id = ${employee.id}::uuid
          )
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET status = 'in_progress', started_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NOT NULL
          AND allocation_id = ${tripRecord.allocationId}::uuid
          AND vehicle_id = ${tripRecord.vehicleId}::uuid
          AND driver_acknowledged_at IS NOT NULL
          AND driver_acknowledged_by_employee_id = ${employee.id}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM employees e
            INNER JOIN driver_profiles dp ON dp.employee_id = e.id
            INNER JOIN driver_licences dl ON dl.driver_profile_id = dp.id
            WHERE e.id = ${employee.id}::uuid
              AND e.tenant_id = ${session.tenantId}::uuid
              AND e.employment_status = 'active'
              AND dp.id = ${licence.profileId}::uuid
              AND dp.driver_status = 'authorised'
              AND dl.id = ${licence.licenceId}::uuid
              AND dl.is_active = true
              AND dl.is_verified = true
              AND dl.verification_status = 'verified'
              AND dl.licence_class = ${licence.licenceClass}
              AND dl.expiry_date >= ${requiredThroughDate}::date
          )
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = 'vehicle_issued'
              AND tr.assigned_driver_employee_id = ${employee.id}::uuid
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.id = ${trip.authorityId}::uuid
              AND ta.trip_id = trips.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'ready_for_departure'
              AND (ta.valid_from IS NULL OR ta.valid_from <= ${nowIso}::timestamptz)
              AND (ta.valid_until IS NULL OR ta.valid_until >= ${nowIso}::timestamptz)
          )
          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = trips.vehicle_id
              AND v.tenant_id = ${session.tenantId}::uuid
              AND v.status = 'available'
              AND v.current_odometer <= ${beginningOdometer}
              AND (
                v.required_licence_class IS NULL
                OR CASE
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) IN ('EC', 'CE') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C', 'BE', 'EB', 'C1E', 'CE1', 'CE', 'EC')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) IN ('C1E', 'CE1') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'BE', 'EB', 'C1E', 'CE1')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) = 'C' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) = 'C1' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) IN ('BE', 'EB') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'BE', 'EB')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) = 'B' THEN
                    upper(replace(v.required_licence_class, ' ', '')) = 'B'
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) = 'A' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('A', 'A1')
                  WHEN upper(replace(${licence.licenceClass}::text, ' ', '')) = 'A1' THEN
                    upper(replace(v.required_licence_class, ' ', '')) = 'A1'
                  ELSE upper(replace(${licence.licenceClass}::text, ' ', '')) = upper(replace(v.required_licence_class, ' ', ''))
                END
              )
              AND (
                v.professional_authorisation_required = false
                OR EXISTS (
                  SELECT 1
                  FROM driver_professional_authorisations dpa
                  WHERE dpa.id = ${professionalAuthorisationId}::uuid
                    AND dpa.driver_profile_id = ${licence.profileId}::uuid
                    AND dpa.is_verified = true
                    AND dpa.expiry_date >= ${requiredThroughDate}::date
                    AND (dpa.valid_from IS NULL OR dpa.valid_from <= ${today}::date)
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects vd
            INNER JOIN vehicles dv ON dv.id = vd.vehicle_id
            WHERE vd.vehicle_id = trips.vehicle_id
              AND dv.tenant_id = ${session.tenantId}::uuid
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
              ORDER BY latest.created_at DESC, latest.id DESC
              LIMIT 1
            )
              AND vi.status = 'completed'
              AND vi.overall_pass = true
              AND COALESCE(vi.odometer_reading, 0) <= ${beginningOdometer}
          )
          AND EXISTS (
            SELECT 1
            FROM trip_issues ti
            WHERE ti.id = ${issue.id}::uuid
              AND ti.trip_id = trips.id
              AND ti.allocation_id = trips.allocation_id
              AND ti.issue_odometer <= ${beginningOdometer}
          )
        RETURNING id, request_id, vehicle_id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'in_progress',
            beginning_odometer = ${beginningOdometer},
            version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${trip.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'ready_for_departure'
          AND EXISTS (SELECT 1 FROM trip_claim)
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'in_progress', updated_at = ${nowIso}::timestamptz
        WHERE id = ${tripRecord.requestId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND assigned_driver_employee_id = ${employee.id}::uuid
          AND status = 'vehicle_issued'
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      ),
      vehicle_claim AS (
        UPDATE vehicles
        SET status = 'allocated', updated_at = ${nowIso}::timestamptz
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
            'allocationVersion', ${trip.allocationVersion + 1}::integer,
            'licenceId', ${licence.licenceId}::text,
            'professionalAuthorisationId', ${professionalAuthorisationId}::text,
            'beginningOdometer', ${beginningOdometer}::integer,
            'fuelLevel', ${fuelLevel}::text,
            'passengersConfirmed', true,
            'location', CASE WHEN ${location}::text IS NULL THEN NULL ELSE ${location}::jsonb END
          ),
          'web'
        FROM status_event
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM vehicle_claim) = 1
         AND (SELECT count(*) FROM status_event) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_trip_start_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM request_claim)::text
          || (SELECT count(*) FROM vehicle_claim)::text
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
      { error: 'Trip, allocation, driver, vehicle, or inspection state changed while departure was being recorded. Refresh and review the latest state.' },
      { status: 409 },
    );
  }
}
