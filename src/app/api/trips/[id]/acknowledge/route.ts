/**
 * Driver Acknowledgement API
 * POST /api/trips/[id]/acknowledge — primary assigned driver accepts the Trip Authority.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      vehicleConfirmed?: boolean;
      authorityConfirmed?: boolean;
      routeUnderstood?: boolean;
      passengersUnderstood?: boolean;
      licenceValidConfirmed?: boolean;
      responsibilityAccepted?: boolean;
      conditionsReviewed?: boolean;
      signature?: string;
      latitude?: number;
      longitude?: number;
      device?: string;
    };

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/driver-mobile', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const confirmations = [
      body.vehicleConfirmed,
      body.authorityConfirmed,
      body.routeUnderstood,
      body.passengersUnderstood,
      body.licenceValidConfirmed,
      body.responsibilityAccepted,
      body.conditionsReviewed,
    ];
    if (confirmations.some((confirmed) => confirmed !== true)) {
      return NextResponse.json(
        {
          error:
            'Confirm the vehicle, authority, route, passenger manifest, licence, responsibility and special conditions',
        },
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
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestStatus: transportRequests.status,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        validUntil: tripAuthorities.validUntil,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
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
      return NextResponse.json({ error: 'Only the primary assigned driver may acknowledge this trip' }, { status: 403 });
    }
    if (trip.driverAcknowledgedAt && trip.authorityStatus === 'driver_accepted') {
      return NextResponse.json({ success: true, alreadyAcknowledged: true });
    }
    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot acknowledge trip with status "${trip.status}". Only pending trips can be acknowledged.` },
        { status: 409 },
      );
    }
    if (!['authorised', 'approved', 'approved_emergency', 'ready_for_issue'].includes(trip.requestStatus)) {
      return NextResponse.json({ error: 'Final authorisation is required before driver acceptance' }, { status: 409 });
    }
    if (trip.authorityStatus !== 'awaiting_driver_acceptance') {
      return NextResponse.json(
        { error: `Trip Authority cannot be accepted from "${trip.authorityStatus}"` },
        { status: 409 },
      );
    }

    // Renewal submissions remain provisional. Use only the operationally active,
    // verified licence so a pending newer upload cannot block an otherwise valid trip.
    const [licence] = await db
      .select({
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        isActive: driverLicences.isActive,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverProfiles)
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(driverProfiles.employeeId, employee.id),
          eq(driverLicences.verificationStatus, 'verified'),
          eq(driverLicences.isActive, true),
        ),
      )
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1);
    const validUntil = trip.validUntil ?? new Date();
    if (
      !licence ||
      licence.driverStatus !== 'authorised' ||
      new Date(`${licence.expiryDate}T23:59:59Z`) < validUntil
    ) {
      return NextResponse.json(
        { error: 'An active verified driver licence valid for the entire trip is required' },
        { status: 409 },
      );
    }

    const acceptedAt = new Date();
    const acceptanceData = JSON.stringify({
      ...body,
      signature: body.signature?.trim() || `confirmed:${session.user.id}`,
      acceptedAt: acceptedAt.toISOString(),
    });
    const auditSequence = Date.now();

    // The deliberate invalid integer cast makes the whole SQL statement fail
    // and roll back if either the authority or trip claim loses a race.
    await db.execute(sql`
      WITH authority_claim AS (
        UPDATE trip_authorities
        SET status = 'driver_accepted',
            accepted_at = ${acceptedAt},
            accepted_by_employee_id = ${employee.id}::uuid,
            acceptance_data = ${acceptanceData}::jsonb,
            updated_at = ${acceptedAt}
        WHERE id = ${trip.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'awaiting_driver_acceptance'
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET driver_acknowledged_by_employee_id = ${employee.id}::uuid,
            driver_acknowledged_at = ${acceptedAt},
            updated_at = ${acceptedAt}
        WHERE id = ${trip.id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND driver_acknowledged_at IS NULL
          AND EXISTS (SELECT 1 FROM authority_claim)
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
          'driver_acknowledged',
          ${session.user.id},
          ${employee.id}::uuid,
          'acknowledge',
          'trip',
          ${trip.id}::uuid,
          'Driver accepted Trip Authority after completing all required confirmations',
          jsonb_build_object('authorityId', ${trip.authorityId}::text, 'status', 'driver_accepted'),
          'web'
        FROM trip_claim
        RETURNING id
      )
      SELECT CASE
        WHEN (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN 1
        ELSE CAST('atomic_driver_acknowledgement_failed' AS integer)
      END AS committed
    `);

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, trip.id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    return NextResponse.json({ success: true, trip: updatedTrip });
  } catch (error) {
    console.error('[trips/acknowledge] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip acceptance changed concurrently or could not be saved. Refresh and try again.' },
      { status: 409 },
    );
  }
}
