/**
 * Driver Acknowledgement API
 *
 * POST /api/trips/[id]/acknowledge — Driver acknowledges trip authority before departure
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { eq, and, desc } from 'drizzle-orm';
import { setAuthorityStatus } from '@/lib/trip-authority';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
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

    const db = getDb();

    // Fetch the trip with tenant isolation
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

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
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
      return NextResponse.json({ error: `Trip Authority cannot be accepted from "${trip.authorityStatus}"` }, { status: 409 });
    }
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
      return NextResponse.json({
        error: 'Confirm the vehicle, authority, route, passenger manifest, licence, responsibility and special conditions',
      }, { status: 422 });
    }

    // Find the current user's employee record to use as acknowledgedByDriverId
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may acknowledge this trip' }, { status: 403 });
    if (trip.driverAcknowledgedAt) return NextResponse.json({ success: true, alreadyAcknowledged: true });
    const [licence] = await db
      .select({
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverProfiles)
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(eq(driverProfiles.employeeId, employee.id))
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1);
    if (
      !licence ||
      licence.verificationStatus !== 'verified' ||
      licence.driverStatus !== 'authorised' ||
      new Date(`${licence.expiryDate}T23:59:59Z`) < (trip.validUntil ?? new Date())
    ) {
      return NextResponse.json({ error: 'A verified driver licence valid for the entire trip is required' }, { status: 409 });
    }

    const [updatedTrip] = await db
      .update(trips)
      .set({
        driverAcknowledgedByEmployeeId: employee.id,
        driverAcknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, trip.id))
      .returning();

    await setAuthorityStatus({
      authorityId: trip.authorityId,
      tenantId: session.tenantId,
      next: 'driver_accepted',
      patch: {
        acceptedAt: new Date(),
        acceptedByEmployeeId: employee.id,
        acceptanceData: {
          ...body,
          signature: body.signature?.trim() || `confirmed:${session.user.id}`,
          acceptedAt: new Date().toISOString(),
        },
      },
    });

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'driver_acknowledged',
      actorUserId: session.user.id,
      action: 'acknowledge',
      entityType: 'trip',
      entityId: id,
      summary: `Driver accepted Trip Authority after completing all required confirmations`,
      after: { authorityId: trip.authorityId, status: 'driver_accepted' },
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, trip: updatedTrip });
  } catch (error) {
    console.error('[trips/acknowledge] POST failed:', error);
    return NextResponse.json({ error: 'Failed to acknowledge trip' }, { status: 500 });
  }
}
