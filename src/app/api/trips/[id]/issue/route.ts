/**
 * Vehicle Issue API
 *
 * POST /api/trips/[id]/issue — Record physical vehicle issue (keys, fuel card, odometer)
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  trips,
  tripAuthorities,
  tripIssues,
  vehicleInspections,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        allocationId: trips.allocationId,
        requestId: trips.requestId,
        issuedAt: trips.issuedAt,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverAcknowledgedByEmployeeId: trips.driverAcknowledgedByEmployeeId,
        requestStatus: transportRequests.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        allocationState: vehicleAllocations.state,
        authorityStatus: tripAuthorities.status,
        authorityBeginningOdometer: tripAuthorities.beginningOdometer,
        vehicleOdometer: vehicles.currentOdometer,
        vehicleStatus: vehicles.status,
      })
      .from(trips)
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(and(
        eq(trips.id, id),
        eq(trips.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(tripAuthorities.tenantId, session.tenantId),
        eq(vehicles.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    if (trip.issuedAt) return NextResponse.json({ error: 'Vehicle has already been physically issued for this trip' }, { status: 409 });
    if (trip.status !== 'pending') {
      return NextResponse.json({ error: `Cannot issue vehicle for trip with status "${trip.status}".` }, { status: 409 });
    }
    if (trip.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation must be confirmed before physical issue (${trip.allocationState})` }, { status: 409 });
    }
    if (trip.requestStatus !== 'authorised') {
      return NextResponse.json({ error: 'Final authorisation is required before issue' }, { status: 409 });
    }
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for physical issue (${trip.authorityStatus})` }, { status: 409 });
    }
    if (trip.vehicleStatus !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available for issue (${trip.vehicleStatus})` }, { status: 409 });
    }
    if (!trip.driverEmployeeId || !trip.driverAcknowledgedAt || trip.driverAcknowledgedByEmployeeId !== trip.driverEmployeeId) {
      return NextResponse.json({ error: 'The assigned driver must acknowledge the trip before issue' }, { status: 409 });
    }

    // Only the latest official departure inspection for this exact trip/vehicle
    // may authorise physical issue. An earlier pass must never override a later
    // failed re-inspection.
    const [departureInspection] = await db
      .select({
        id: vehicleInspections.id,
        odometerReading: vehicleInspections.odometerReading,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
      })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tenantId, session.tenantId),
        eq(vehicleInspections.tripId, id),
        eq(vehicleInspections.vehicleId, trip.vehicleId),
        eq(vehicleInspections.type, 'departure'),
      ))
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(1);
    if (!departureInspection || departureInspection.status !== 'completed' || departureInspection.overallPass !== true) {
      return NextResponse.json(
        { error: 'The latest pre-departure inspection for the currently allocated vehicle must be completed and passed before issue' },
        { status: 409 },
      );
    }

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(and(
        eq(vehicleDefects.vehicleId, trip.vehicleId),
        eq(vehicles.tenantId, session.tenantId),
        eq(vehicleDefects.isBlocking, true),
        isNull(vehicleDefects.resolvedAt),
      ))
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Vehicle issue is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      issueOdometer?: number;
      keysIssued?: boolean;
      fuelCardIssued?: boolean;
      notes?: string;
    };
    const issueOdometer = Number(body.issueOdometer);
    const keysIssued = body.keysIssued ?? true;
    const fuelCardIssued = body.fuelCardIssued ?? false;
    const notes = body.notes?.trim() || null;
    if (notes && notes.length > 2000) {
      return NextResponse.json({ error: 'Issue notes must be 2000 characters or fewer' }, { status: 422 });
    }

    const minimumOdometer = Math.max(
      trip.authorityBeginningOdometer ?? 0,
      departureInspection.odometerReading ?? 0,
      trip.vehicleOdometer ?? 0,
    );
    if (!Number.isInteger(issueOdometer) || issueOdometer < minimumOdometer) {
      return NextResponse.json(
        { error: `Issue odometer must be a whole number at or above ${minimumOdometer}` },
        { status: 422 },
      );
    }
    if (keysIssued !== true) {
      return NextResponse.json({ error: 'Vehicle keys must be issued before departure' }, { status: 422 });
    }

    const now = new Date();
    const issueId = randomUUID();
    const auditSequence = Date.now();

    // Claim the still-unissued trip first. Re-evaluate every safety/lifecycle
    // prerequisite inside the same SQL statement so a defect, re-inspection,
    // vehicle status change, de-authorisation or driver reassignment occurring
    // after the initial page read cannot race physical issue.
    await db.execute(sql`
      WITH trip_claim AS (
        UPDATE trips
        SET issued_at = ${now}, updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NULL
          AND vehicle_id = ${trip.vehicleId}::uuid
          AND allocation_id = ${trip.allocationId}::uuid
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = 'authorised'
          )
          AND EXISTS (
            SELECT 1
            FROM vehicle_allocations va
            WHERE va.id = trips.allocation_id
              AND va.state = 'confirmed'
              AND va.driver_employee_id = ${trip.driverEmployeeId}::uuid
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.trip_id = trips.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'ready_for_departure'
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
              ORDER BY latest.created_at DESC
              LIMIT 1
            )
              AND vi.status = 'completed'
              AND vi.overall_pass = true
          )
        RETURNING id, request_id, allocation_id
      ),
      issue_insert AS (
        INSERT INTO trip_issues (
          id, trip_id, allocation_id, issued_at, issue_odometer,
          keys_issued, fuel_card_issued, issued_by_user_id,
          acknowledged_by_driver_id, acknowledged_at, notes
        )
        SELECT
          ${issueId}::uuid,
          ${id}::uuid,
          ${trip.allocationId}::uuid,
          ${now},
          ${issueOdometer},
          true,
          ${fuelCardIssued},
          ${session.user.id},
          ${trip.driverEmployeeId}::uuid,
          ${trip.driverAcknowledgedAt},
          ${notes}
        FROM trip_claim
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'vehicle_issued', updated_at = ${now}
        WHERE id = ${trip.requestId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'authorised'
          AND EXISTS (SELECT 1 FROM issue_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'vehicle_issued',
          ${session.user.id},
          'issue',
          'trip',
          ${id}::uuid,
          ${`Vehicle issued: keys=true, fuelCard=${fuelCardIssued}, odometer=${issueOdometer}`},
          'web'
        FROM request_claim
        RETURNING id
      )
      -- Keep the rollback sentinel dependent on the data-changing CTE results.
      -- A constant invalid cast in the ELSE branch may be folded by PostgreSQL
      -- while planning, which aborts even a fully successful issue operation.
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM issue_insert) = 1
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_trip_issue_failed_'
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM issue_insert)::text
          || (SELECT count(*) FROM request_claim)::text
          || (SELECT count(*) FROM audit_insert)::text
      END AS integer) AS committed
    `);

    const [issue] = await db
      .select()
      .from(tripIssues)
      .where(eq(tripIssues.id, issueId))
      .limit(1);
    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[trips/issue] POST failed:', error);
    if (String(error).includes('atomic_trip_issue_failed')) {
      return NextResponse.json(
        { error: 'Trip state changed while the vehicle was being issued. Refresh and review the latest trip state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to issue vehicle' }, { status: 500 });
  }
}
