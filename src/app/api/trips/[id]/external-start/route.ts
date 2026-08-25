import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import {
  tripAuthorities,
  tripIssues,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { onTripIssued } from '@/lib/document-generator';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

type RouteContext = { params: Promise<{ id: string }> };

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

    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignmentId: externalDriverAssignments.id,
        externalPartyId: externalDriverAssignments.externalPartyId,
        assignmentState: externalDriverAssignments.state,
        assignmentIssueId: externalDriverAssignments.issueId,
        assignmentAcceptedAt: externalDriverAssignments.acceptedAt,
        licenceId: externalDriverAssignments.licenceId,
        licenceStatus: externalDriverLicences.verificationStatus,
        licenceClass: externalDriverLicences.licenceClass,
        licenceExpiry: externalDriverLicences.expiryDate,
        partyStatus: externalParties.status,
        tripStatus: trips.status,
        tripIssuedAt: trips.issuedAt,
        requestId: trips.requestId,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        requestExternalDriverPartyId: transportRequests.assignedDriverExternalPartyId,
        allocationId: trips.allocationId,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        vehicleId: trips.vehicleId,
        vehicleStatus: vehicles.status,
        vehicleOdometer: vehicles.currentOdometer,
        vehicleRequiredLicenceClass: vehicles.requiredLicenceClass,
        vehicleProfessionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        authorityValidFrom: tripAuthorities.validFrom,
        authorityValidUntil: tripAuthorities.validUntil,
        issueOdometer: tripIssues.issueOdometer,
      })
      .from(externalDriverAssignments)
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.id, externalDriverAssignments.licenceId))
      .innerJoin(tripIssues, eq(tripIssues.id, externalDriverAssignments.issueId))
      .where(
        and(
          eq(externalDriverAssignments.tripId, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(trips.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(vehicles.tenantId, tenantId),
          eq(tripAuthorities.tenantId, tenantId),
          eq(externalParties.tenantId, tenantId),
          eq(externalDriverLicences.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!record) {
      return NextResponse.json(
        { error: 'External-driver trip is not ready for departure or has not been physically issued' },
        { status: 404 },
      );
    }
    if (record.assignmentState !== 'accepted' || !record.assignmentAcceptedAt || !record.assignmentIssueId) {
      return NextResponse.json({ error: 'Accepted external assignment and physical issue are required before departure' }, { status: 409 });
    }
    if (record.requestExternalDriverPartyId !== record.externalPartyId) {
      return NextResponse.json({ error: 'The accepted external driver is no longer the request’s assigned driver' }, { status: 409 });
    }
    if (record.tripStatus !== 'pending') {
      return NextResponse.json({ error: `Cannot start trip with status "${record.tripStatus}".` }, { status: 409 });
    }
    if (!record.tripIssuedAt) {
      return NextResponse.json({ error: 'Vehicle must be physically issued before the trip starts' }, { status: 409 });
    }
    if (record.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation must be confirmed before departure (${record.allocationState})` }, { status: 409 });
    }
    if (record.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for departure (${record.authorityStatus})` }, { status: 409 });
    }
    if (record.requestStatus !== 'vehicle_issued') {
      return NextResponse.json({ error: `Request is not ready to start (${record.requestStatus})` }, { status: 409 });
    }
    if (record.vehicleStatus !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available for departure (${record.vehicleStatus})` }, { status: 409 });
    }
    if (record.partyStatus !== 'active' || record.licenceStatus !== 'verified') {
      return NextResponse.json({ error: 'External driver eligibility is no longer valid' }, { status: 409 });
    }
    if (
      record.vehicleRequiredLicenceClass &&
      !namibiaLicenceClassCovers(record.licenceClass, record.vehicleRequiredLicenceClass)
    ) {
      return NextResponse.json(
        { error: 'External driver licence no longer covers the current vehicle class' },
        { status: 409 },
      );
    }
    if (record.vehicleProfessionalAuthorisationRequired) {
      return NextResponse.json(
        {
          error:
            'The current vehicle requires professional driving authorisation. External departure is blocked until verified professional-authorisation evidence is supported for the assignment.',
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    if ((record.authorityValidFrom && now < record.authorityValidFrom) || (record.authorityValidUntil && now > record.authorityValidUntil)) {
      return NextResponse.json({ error: 'Trip Authority is outside its approved validity period' }, { status: 409 });
    }
    const expiryAt = new Date(`${record.licenceExpiry}T23:59:59.999Z`);
    if (!Number.isFinite(expiryAt.getTime()) || expiryAt < (record.authorityValidUntil ?? now)) {
      return NextResponse.json({ error: 'External driver licence no longer covers the authorised trip period' }, { status: 409 });
    }

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDefects.vehicleId, record.vehicleId),
          eq(vehicles.tenantId, tenantId),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ),
      )
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Departure is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }

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
          eq(vehicleInspections.tenantId, tenantId),
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.vehicleId, record.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    if (!inspection || inspection.status !== 'completed' || inspection.overallPass !== true) {
      return NextResponse.json({ error: 'The latest pre-departure inspection for the current vehicle must be completed and passed' }, { status: 409 });
    }

    const minimumOdometer = Math.max(
      record.issueOdometer ?? 0,
      inspection.odometerReading ?? 0,
      record.vehicleOdometer ?? 0,
    );
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
    const beginningOdometer = Number(body.beginningOdometer);
    const auditSequence = Date.now();

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${nowIso}::timestamptz
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
              AND t.status = 'pending'
              AND t.issued_at IS NOT NULL
          )
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET status = 'in_progress', started_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NOT NULL
          AND allocation_id = ${record.allocationId}::uuid
          AND vehicle_id = ${record.vehicleId}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM external_driver_assignments eda
            INNER JOIN external_parties ep ON ep.id = eda.external_party_id
            INNER JOIN external_driver_licences edl ON edl.id = eda.licence_id
            INNER JOIN trip_issues ti ON ti.id = eda.issue_id
            WHERE eda.id = ${record.assignmentId}::uuid
              AND eda.tenant_id = ${tenantId}::uuid
              AND eda.trip_id = trips.id
              AND eda.allocation_id = trips.allocation_id
              AND eda.external_party_id = ${record.externalPartyId}::uuid
              AND eda.licence_id = ${record.licenceId}::uuid
              AND eda.state = 'accepted'
              AND eda.accepted_at IS NOT NULL
              AND eda.issue_id = ${record.assignmentIssueId}::uuid
              AND ti.id = eda.issue_id
              AND ti.trip_id = trips.id
              AND ti.allocation_id = trips.allocation_id
              AND ti.issue_odometer <= ${beginningOdometer}
              AND ep.tenant_id = ${tenantId}::uuid
              AND ep.status = 'active'
              AND edl.tenant_id = ${tenantId}::uuid
              AND edl.verification_status = 'verified'
              AND edl.licence_class = ${record.licenceClass}
              AND edl.expiry_date >= COALESCE(
                (SELECT ta.valid_until::date FROM trip_authorities ta WHERE ta.trip_id = trips.id AND ta.tenant_id = ${tenantId}::uuid),
                CURRENT_DATE
              )
          )
          AND EXISTS (
            SELECT 1 FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${tenantId}::uuid
              AND tr.status = 'vehicle_issued'
              AND tr.assigned_driver_external_party_id = ${record.externalPartyId}::uuid
          )
          AND EXISTS (
            SELECT 1 FROM trip_authorities ta
            WHERE ta.trip_id = trips.id
              AND ta.tenant_id = ${tenantId}::uuid
              AND ta.status = 'ready_for_departure'
              AND (ta.valid_from IS NULL OR ta.valid_from <= ${nowIso}::timestamptz)
              AND (ta.valid_until IS NULL OR ta.valid_until >= ${nowIso}::timestamptz)
          )
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = trips.vehicle_id
              AND v.tenant_id = ${tenantId}::uuid
              AND v.status = 'available'
              AND v.current_odometer <= ${beginningOdometer}
              AND v.professional_authorisation_required = false
              AND (
                v.required_licence_class IS NULL
                OR CASE
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('EC', 'CE') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C', 'BE', 'EB', 'C1E', 'CE1', 'CE', 'EC')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('C1E', 'CE1') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'BE', 'EB', 'C1E', 'CE1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'C' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'C1' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('BE', 'EB') THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'BE', 'EB')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'B' THEN
                    upper(replace(v.required_licence_class, ' ', '')) = 'B'
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'A' THEN
                    upper(replace(v.required_licence_class, ' ', '')) IN ('A', 'A1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'A1' THEN
                    upper(replace(v.required_licence_class, ' ', '')) = 'A1'
                  ELSE upper(replace(${record.licenceClass}::text, ' ', '')) = upper(replace(v.required_licence_class, ' ', ''))
                END
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects vd
            INNER JOIN vehicles dv ON dv.id = vd.vehicle_id
            WHERE vd.vehicle_id = trips.vehicle_id
              AND dv.tenant_id = ${tenantId}::uuid
              AND vd.is_blocking = true
              AND vd.resolved_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM vehicle_inspections vi
            WHERE vi.id = (
              SELECT latest.id
              FROM vehicle_inspections latest
              WHERE latest.tenant_id = ${tenantId}::uuid
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
        RETURNING id, request_id, vehicle_id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'in_progress',
            beginning_odometer = ${beginningOdometer},
            version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.authorityId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'ready_for_departure'
          AND EXISTS (SELECT 1 FROM trip_claim)
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'in_progress', updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.requestId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND assigned_driver_external_party_id = ${record.externalPartyId}::uuid
          AND status = 'vehicle_issued'
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      ),
      vehicle_claim AS (
        UPDATE vehicles
        SET status = 'allocated', updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.vehicleId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'available'
          AND professional_authorisation_required = false
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      status_event AS (
        INSERT INTO vehicle_status_events (
          vehicle_id, previous_status, new_status, reason, changed_by_user_id,
          reference_entity_type, reference_entity_id
        )
        SELECT
          ${record.vehicleId}::uuid,
          'available',
          'allocated',
          ${`External-driver trip started: ${id.slice(0, 8)}...`},
          ${session.user.id},
          'trip',
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
          ${tenantId}::uuid,
          ${auditSequence},
          'trip_started_external_driver',
          ${session.user.id},
          'external_start',
          'trip',
          ${id}::uuid,
          ${`Transport Office started accepted external-driver trip for ${record.requestReference}`},
          jsonb_build_object(
            'externalDriverAssignmentId', ${record.assignmentId}::text,
            'externalDriverPartyId', ${record.externalPartyId}::text,
            'authorityId', ${record.authorityId}::text,
            'allocationVersion', ${record.allocationVersion + 1}::integer,
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
        ELSE 'atomic_external_trip_start_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM request_claim)::text
          || (SELECT count(*) FROM vehicle_claim)::text
      END AS integer) AS committed
    `);

    if (record.allocationId) {
      await onTripIssued(record.allocationId, tenantId, session.user.id).catch((error) =>
        console.warn('[trips/external-start] Post-commit document generation failed:', error),
      );
    }
    await recordTenantRequestActivity({
      tenantId,
      requestId: record.requestId,
      reference: record.requestReference,
      stage: 'started',
      officeLabel: 'Transport office · external driver',
    }).catch((error) => console.warn('[trips/external-start] Post-commit activity failed:', error));

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)))
      .limit(1);
    return NextResponse.json({ trip: updatedTrip, externalDriverAssignmentId: record.assignmentId });
  } catch (error) {
    console.error('[trips/external-start] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip, allocation, driver, vehicle, or inspection state changed while external departure was being recorded. Refresh and review the latest state.' },
      { status: 409 },
    );
  }
}
