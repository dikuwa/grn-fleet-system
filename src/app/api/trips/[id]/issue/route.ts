/**
 * Vehicle Issue API
 *
 * POST /api/trips/[id]/issue — Record physical vehicle issue (keys, fuel card, odometer)
 *
 * Physical issue is the final operational release boundary. Compliance is
 * revalidated here instead of trusting an earlier allocation-time decision,
 * because licence/availability/vehicle conditions can change before departure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  trips,
  tripAuthorities,
  tripIssues,
  vehicleInspections,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import {
  driverLicenceCodes,
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import {
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { and, desc, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm';

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'released'] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverAcknowledgedByEmployeeId: trips.driverAcknowledgedByEmployeeId,
        requestStatus: transportRequests.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        allocationState: vehicleAllocations.state,
        allocationStartAt: vehicleAllocations.startAt,
        allocationEndAt: vehicleAllocations.endAt,
        authorityStatus: tripAuthorities.status,
        authorityBeginningOdometer: tripAuthorities.beginningOdometer,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        vehicleStatus: vehicles.status,
      })
      .from(trips)
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .where(
        and(
          eq(trips.id, id),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status !== 'pending') {
      return NextResponse.json(
        {
          error: `Cannot issue vehicle for trip with status "${trip.status}". Only pending trips can be issued.`,
        },
        { status: 409 },
      );
    }
    if (!trip.allocationId) {
      return NextResponse.json(
        { error: 'Trip has no allocation. Cannot issue vehicle.' },
        { status: 400 },
      );
    }
    if (trip.allocationState !== 'confirmed') {
      return NextResponse.json(
        { error: `Allocation must be confirmed before physical issue (${trip.allocationState}).` },
        { status: 409 },
      );
    }
    if (trip.requestStatus !== 'authorised') {
      return NextResponse.json(
        { error: 'Final authorisation is required before issue' },
        { status: 409 },
      );
    }
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json(
        { error: `Trip Authority is not ready for physical issue (${trip.authorityStatus})` },
        { status: 409 },
      );
    }
    if (
      !trip.driverEmployeeId ||
      !trip.driverAcknowledgedAt ||
      trip.driverAcknowledgedByEmployeeId !== trip.driverEmployeeId
    ) {
      return NextResponse.json(
        { error: 'The assigned driver must acknowledge the trip before issue' },
        { status: 409 },
      );
    }

    const [departureInspection] = await db
      .select({ id: vehicleInspections.id })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.type, 'departure'),
          eq(vehicleInspections.status, 'completed'),
          eq(vehicleInspections.overallPass, true),
        ),
      )
      .limit(1);
    if (!departureInspection) {
      return NextResponse.json(
        { error: 'A passed pre-departure inspection is required before issue' },
        { status: 409 },
      );
    }

    // Revalidate the assigned driver against current operational conditions.
    const [driver] = await db
      .select({
        id: employees.id,
        employmentStatus: employees.employmentStatus,
        availabilityStatus: employees.availabilityStatus,
        profileId: driverProfiles.id,
        driverStatus: driverProfiles.driverStatus,
        profileAvailability: driverProfiles.availabilityStatus,
        licenceId: driverLicences.id,
        licenceStatus: driverLicences.verificationStatus,
        licenceExpiry: driverLicences.expiryDate,
        licenceClass: driverLicences.licenceClass,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(employees.id, trip.driverEmployeeId),
          eq(employees.tenantId, session.tenantId),
          eq(employees.isDriver, true),
          eq(driverLicences.isActive, true),
        ),
      )
      .orderBy(desc(driverLicences.version))
      .limit(1);

    if (!driver) {
      return NextResponse.json(
        { error: 'The assigned driver no longer has an active licence profile.' },
        { status: 409 },
      );
    }

    const [licenceCodes, professionalRows, driverConflictRows, blockingDefectRows] =
      await Promise.all([
        db
          .select({ code: driverLicenceCodes.code })
          .from(driverLicenceCodes)
          .where(
            and(
              eq(driverLicenceCodes.licenceId, driver.licenceId),
              eq(driverLicenceCodes.isActive, true),
            ),
          ),
        db
          .select({
            isVerified: driverProfessionalAuthorisations.isVerified,
            expiryDate: driverProfessionalAuthorisations.expiryDate,
          })
          .from(driverProfessionalAuthorisations)
          .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
          .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
          .limit(1),
        db
          .select({ id: vehicleAllocations.id })
          .from(vehicleAllocations)
          .where(
            and(
              eq(vehicleAllocations.driverEmployeeId, trip.driverEmployeeId),
              ne(vehicleAllocations.id, trip.allocationId),
              inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
              lt(vehicleAllocations.startAt, trip.allocationEndAt),
              gt(vehicleAllocations.endAt, trip.allocationStartAt),
            ),
          )
          .limit(1),
        db
          .select({ id: vehicleDefects.id })
          .from(vehicleDefects)
          .where(
            and(
              eq(vehicleDefects.vehicleId, trip.vehicleId),
              eq(vehicleDefects.isBlocking, true),
              isNull(vehicleDefects.resolvedAt),
            ),
          )
          .limit(1),
      ]);

    const activeLicenceCodes = [
      ...licenceCodes.map((row) => row.code),
      ...String(driver.licenceClass || '')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
    ];
    const professional = professionalRows[0];
    const compliance = calculateDriverCompliance({
      employeeStatus: driver.employmentStatus,
      availabilityStatus:
        driver.availabilityStatus !== 'available'
          ? driver.availabilityStatus
          : driver.profileAvailability,
      driverStatus: driver.driverStatus,
      licenceStatus: driver.licenceStatus,
      licenceExpiry: driver.licenceExpiry,
      licenceCodes: Array.from(new Set(activeLicenceCodes)),
      requiredLicenceClass: trip.requiredLicenceClass || undefined,
      professionalRequired: trip.professionalAuthorisationRequired,
      professionalVerified: professional?.isVerified,
      professionalExpiry: professional?.expiryDate,
      tripEndAt: trip.allocationEndAt,
      hasScheduleConflict: driverConflictRows.length > 0,
    });

    if (!['eligible', 'eligible_expiring_soon'].includes(compliance.status)) {
      return NextResponse.json(
        {
          error: 'The assigned driver no longer meets release requirements.',
          compliance,
        },
        { status: 409 },
      );
    }
    if (blockingDefectRows.length > 0) {
      return NextResponse.json(
        { error: 'The vehicle has an unresolved blocking defect and cannot be issued.' },
        { status: 409 },
      );
    }
    if (['out_of_service', 'decommissioned', 'expired', 'maintenance'].includes(trip.vehicleStatus)) {
      return NextResponse.json(
        { error: `Vehicle cannot be issued while status is "${trip.vehicleStatus}".` },
        { status: 409 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const { issueOdometer, keysIssued = true, fuelCardIssued = false, notes } = body;
    if (
      !Number.isInteger(Number(issueOdometer)) ||
      Number(issueOdometer) < (trip.authorityBeginningOdometer ?? 0)
    ) {
      return NextResponse.json(
        {
          error: `Issue odometer must be a whole number at or above ${trip.authorityBeginningOdometer ?? 0}`,
        },
        { status: 422 },
      );
    }
    if (keysIssued !== true) {
      return NextResponse.json(
        { error: 'Vehicle keys must be issued before departure' },
        { status: 422 },
      );
    }

    const [existingIssue] = await db
      .select({ id: tripIssues.id })
      .from(tripIssues)
      .where(eq(tripIssues.allocationId, trip.allocationId))
      .limit(1);

    if (existingIssue) {
      return NextResponse.json(
        { error: 'Vehicle already issued for this allocation' },
        { status: 409 },
      );
    }

    const issuedAt = new Date();
    const issue = await db.transaction(async (tx) => {
      const [createdIssue] = await tx
        .insert(tripIssues)
        .values({
          tripId: id,
          allocationId: trip.allocationId,
          issuedAt,
          issueOdometer: Number(issueOdometer),
          keysIssued,
          fuelCardIssued,
          issuedByUserId: session.user.id,
          acknowledgedByDriverId: trip.driverEmployeeId,
          acknowledgedAt: trip.driverAcknowledgedAt,
          notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        })
        .returning();

      await tx
        .update(trips)
        .set({ issuedAt, updatedAt: issuedAt })
        .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)));

      await tx
        .update(transportRequests)
        .set({ status: 'vehicle_issued', updatedAt: issuedAt })
        .where(
          and(
            eq(transportRequests.id, trip.requestId),
            eq(transportRequests.tenantId, session.tenantId),
          ),
        );

      await tx
        .update(vehicleAllocations)
        .set({ state: 'released', updatedAt: issuedAt })
        .where(eq(vehicleAllocations.id, trip.allocationId));

      await tx.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'vehicle_issued',
        actorUserId: session.user.id,
        action: 'issue',
        entityType: 'trip',
        entityId: id,
        summary: `Vehicle issued: keys=${keysIssued}, fuelCard=${fuelCardIssued}, odometer=${Number(issueOdometer)}`,
        before: { allocationState: trip.allocationState, requestStatus: trip.requestStatus },
        after: {
          allocationState: 'released',
          requestStatus: 'vehicle_issued',
          issuedAt: issuedAt.toISOString(),
          issueOdometer: Number(issueOdometer),
          driverCompliance: compliance.status,
        },
        sourceChannel: 'web',
      });

      return createdIssue;
    });

    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[trips/issue] POST failed:', error);
    return NextResponse.json({ error: 'Failed to issue vehicle' }, { status: 500 });
  }
}
