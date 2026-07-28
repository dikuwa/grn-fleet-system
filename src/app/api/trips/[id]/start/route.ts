import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleInspections, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleStatusEvents } from '@/db/schema/fleet';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { setAuthorityStatus } from '@/lib/trip-authority';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      beginningOdometer?: number;
      passengersConfirmed?: boolean;
      fuelLevel?: string;
      latitude?: number;
      longitude?: number;
      clientSyncId?: string;
    };
    if (
      !Number.isInteger(body.beginningOdometer) ||
      Number(body.beginningOdometer) < 0 ||
      body.passengersConfirmed !== true ||
      !body.fuelLevel
    ) {
      return NextResponse.json({
        error: 'Beginning odometer, fuel level and actual passenger confirmation are required',
      }, { status: 422 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requireAnyPermission(session, [Permissions.TRIP_MANAGE, Permissions.DRIVER_LOG_CREATE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [trip] = await db
      .select({
        trip: trips,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        validFrom: tripAuthorities.validFrom,
        validUntil: tripAuthorities.validUntil,
        requestReference: transportRequests.reference,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const tripRecord = trip.trip;

    if (tripRecord.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot start trip with status "${tripRecord.status}". Only pending trips can be started.` },
        { status: 409 },
      );
    }
    if (!tripRecord.issuedAt) return NextResponse.json({ error: 'Vehicle must be physically issued before the trip starts' }, { status: 409 });
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for departure (${trip.authorityStatus})` }, { status: 409 });
    }
    const now = new Date();
    if ((trip.validFrom && now < trip.validFrom) || (trip.validUntil && now > trip.validUntil)) {
      return NextResponse.json({ error: 'Trip Authority is outside its approved validity period' }, { status: 409 });
    }
    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId))).limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may start this trip' }, { status: 403 });
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
      licence.driverStatus !== 'authorised' ||
      licence.verificationStatus !== 'verified' ||
      new Date(`${licence.expiryDate}T23:59:59Z`) < now
    ) {
      return NextResponse.json({ error: 'Driver licence is not currently valid and verified' }, { status: 409 });
    }
    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .where(and(
        eq(vehicleDefects.vehicleId, tripRecord.vehicleId),
        eq(vehicleDefects.isBlocking, true),
        isNull(vehicleDefects.resolvedAt),
      ))
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Departure is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }
    const [inspection] = await db.select({
      id: vehicleInspections.id,
      odometerReading: vehicleInspections.odometerReading,
    }).from(vehicleInspections)
      .where(and(eq(vehicleInspections.tripId, id), eq(vehicleInspections.type, 'departure'), eq(vehicleInspections.overallPass, true))).limit(1);
    if (!inspection) return NextResponse.json({ error: 'Passed pre-departure inspection is required' }, { status: 409 });
    if (
      inspection.odometerReading !== null &&
      Number(body.beginningOdometer) < inspection.odometerReading
    ) {
      return NextResponse.json({ error: `Beginning odometer cannot be lower than the inspection reading (${inspection.odometerReading})` }, { status: 422 });
    }

    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();

    await setAuthorityStatus({
      authorityId: trip.authorityId,
      tenantId: session.tenantId,
      next: 'in_progress',
      patch: { beginningOdometer: Number(body.beginningOdometer) },
    });

    // Update vehicle status to allocated + log status event
    await db
      .update(vehicles)
      .set({ status: 'allocated', updatedAt: new Date() })
      .where(eq(vehicles.id, tripRecord.vehicleId));

    await db.insert(vehicleStatusEvents).values({
      vehicleId: tripRecord.vehicleId,
      previousStatus: 'available',
      newStatus: 'allocated',
      reason: `Trip started: ${tripRecord.id.slice(0, 8)}...`,
      changedByUserId: session.user.id,
      referenceEntityType: 'trip',
      referenceEntityId: tripRecord.id,
    });

    // Generate trip authority document when trip is issued
    if (tripRecord.allocationId) {
      await onTripIssued(tripRecord.allocationId, session.tenantId, session.user.id).catch((err) => {
        console.warn('[trips/start] Document generation failed:', err);
      });
    }
    await db.update(transportRequests).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(transportRequests.id, tripRecord.requestId));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'trip_started',
      actorUserId: session.user.id,
      action: 'start',
      entityType: 'trip',
      entityId: id,
      summary: `Trip started: vehicle ${tripRecord.vehicleId?.slice(0, 8) || 'unknown'}`,
      after: {
        authorityId: trip.authorityId,
        beginningOdometer: body.beginningOdometer,
        fuelLevel: body.fuelLevel,
        passengersConfirmed: true,
        location: body.latitude && body.longitude ? { latitude: body.latitude, longitude: body.longitude } : null,
      },
      sourceChannel: 'web',
    });
    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: tripRecord.requestId,
      reference: trip.requestReference,
      stage: 'started',
      officeLabel: 'Assigned driver',
    });

    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/start] POST failed:', error);
    return NextResponse.json({ error: 'Failed to start trip' }, { status: 500 });
  }
}
