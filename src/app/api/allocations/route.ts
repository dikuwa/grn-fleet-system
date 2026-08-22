import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/db';
import { vehicleAllocations, trips } from '@/db/schema/trips';
import { requestDrivers, transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { VehicleRecommender } from '@/lib/vehicle-recommender';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import {
  driverLicenceCodes,
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { recordAuditEvent } from '@/lib/audit-event';
import { createScopedNotifications } from '@/lib/notification-service';
import { runAtomicMutations } from '@/lib/db-atomic';

const ALLOCATABLE_STATUSES = [
  'approved',
  'under_review',
  'transport_review',
  'release_pending',
  'vehicle_allocated',
];
const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;

const ALLOCATION_DB_ERROR_MESSAGES: Record<string, { status: number; error: string }> = {
  allocation_request_already_live: {
    status: 409,
    error: 'This transport request already has a live allocation. Refresh the request before creating another allocation.',
  },
  allocation_vehicle_overlap: {
    status: 409,
    error: 'Vehicle is already allocated during this period.',
  },
  allocation_driver_overlap: {
    status: 409,
    error: 'Driver is already assigned to another live allocation during this period.',
  },
  allocation_vehicle_not_available: {
    status: 409,
    error: 'Vehicle availability changed before the allocation could be saved. Refresh the vehicle list and choose an available vehicle.',
  },
  allocation_vehicle_blocking_defect: {
    status: 409,
    error: 'Vehicle has an unresolved blocking defect and cannot be allocated until it is cleared.',
  },
  allocation_invalid_period: {
    status: 400,
    error: 'Allocation dates are invalid. The end date must be after the start date.',
  },
  allocation_vehicle_not_found: {
    status: 404,
    error: 'Vehicle no longer exists. Refresh the request and select another vehicle.',
  },
};

function describeAllocationDbError(error: unknown) {
  const candidate = error as {
    code?: string;
    message?: string;
    detail?: string;
    cause?: unknown;
  };
  const diagnostic = [candidate?.message, candidate?.detail, String(candidate?.cause ?? ''), String(error)]
    .filter(Boolean)
    .join(' ');

  for (const [marker, response] of Object.entries(ALLOCATION_DB_ERROR_MESSAGES)) {
    if (diagnostic.includes(marker)) return response;
  }

  if (candidate?.code === '23P01') {
    return {
      status: 409,
      error: 'Allocation conflicts with an existing live reservation. Refresh the request and try again.',
    };
  }
  if (candidate?.code === '23514') {
    return {
      status: 409,
      error: 'Allocation no longer satisfies the current vehicle safety or availability rules. Refresh and try again.',
    };
  }
  if (candidate?.code === '23503') {
    return {
      status: 409,
      error: 'A vehicle, driver, or request used by this allocation changed before it could be saved. Refresh and try again.',
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      requestId,
      requestReference,
      vehicleId,
      vehicleGrn,
      startDate,
      endDate,
      recommendOnly,
      recommendAuto,
      driverEmployeeId,
    } = body;

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    let resolvedRequestId = requestId;
    if (!resolvedRequestId && requestReference) {
      const [found] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(and(eq(transportRequests.reference, requestReference), eq(transportRequests.tenantId, tenantId)))
        .limit(1);
      if (found) resolvedRequestId = found.id;
    }

    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && vehicleGrn) {
      const [found] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.licenceNumber, vehicleGrn), eq(vehicles.tenantId, tenantId)))
        .limit(1);
      if (found) resolvedVehicleId = found.id;
    }

    if (!resolvedRequestId) {
      return NextResponse.json({ error: 'Request ID or reference is required' }, { status: 400 });
    }

    const [foundReq] = await db
      .select({
        id: transportRequests.id,
        status: transportRequests.status,
        reference: transportRequests.reference,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        requesterUserId: transportRequests.requesterUserId,
      })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, resolvedRequestId), eq(transportRequests.tenantId, tenantId)))
      .limit(1);

    if (!foundReq) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }
    if (!ALLOCATABLE_STATUSES.includes(foundReq.status)) {
      return NextResponse.json({ error: `Request cannot be allocated while status is "${foundReq.status}"` }, { status: 409 });
    }

    if (recommendOnly) {
      const recommender = new VehicleRecommender({ db });
      const recommendation = await recommender.findBestMatch(resolvedRequestId);
      return NextResponse.json({ recommendation });
    }

    let recommendation: Awaited<ReturnType<VehicleRecommender['findBestMatch']>> | null = null;
    if (!resolvedVehicleId || recommendAuto) {
      const recommender = new VehicleRecommender({ db });
      recommendation = await recommender.findBestMatch(resolvedRequestId);
      if (!resolvedVehicleId && recommendAuto && recommendation.topVariant) {
        resolvedVehicleId = recommendation.topVariant.vehicleId;
      }
    }

    if (!resolvedVehicleId) {
      const errorMsg =
        recommendation && recommendation.totalAvailable === 0
          ? 'No available vehicles found for this request. No auto-recommendation possible.'
          : 'Vehicle ID or GRN is required. Use recommendAuto: true for auto-selection.';
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    const [vehicle] = await db
      .select({
        id: vehicles.id,
        status: vehicles.status,
        licenceNumber: vehicles.licenceNumber,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, resolvedVehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }
    if (vehicle.status !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available (status: ${vehicle.status})` }, { status: 409 });
    }

    const startAt = new Date(startDate);
    const endAt = endDate ? new Date(endDate) : new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      return NextResponse.json({ error: 'Allocation dates are invalid' }, { status: 400 });
    }

    const [vehicleOverlap] = await db.select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        eq(vehicleAllocations.vehicleId, resolvedVehicleId),
        inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
        lt(vehicleAllocations.startAt, endAt),
        gt(vehicleAllocations.endAt, startAt),
      ))
      .limit(1);
    if (vehicleOverlap) {
      return NextResponse.json({ error: 'Vehicle is already allocated during this period' }, { status: 409 });
    }

    const resolvedDriverId: string | null = driverEmployeeId || null;
    let driverCompliance: ReturnType<typeof calculateDriverCompliance> | null = null;
    if (resolvedDriverId) {
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
        .where(and(
          eq(employees.id, resolvedDriverId),
          eq(employees.tenantId, tenantId),
          eq(employees.isDriver, true),
          eq(driverLicences.isActive, true),
        ))
        .orderBy(desc(driverLicences.version))
        .limit(1);

      if (!driver) {
        return NextResponse.json({ error: 'Driver has no active licence profile.' }, { status: 409 });
      }

      const [codes, professional, driverConflict] = await Promise.all([
        db.select({ code: driverLicenceCodes.code }).from(driverLicenceCodes)
          .where(and(eq(driverLicenceCodes.licenceId, driver.licenceId), eq(driverLicenceCodes.isActive, true))),
        db.select().from(driverProfessionalAuthorisations)
          .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
          .orderBy(desc(driverProfessionalAuthorisations.expiryDate)).limit(1),
        db.select({ id: vehicleAllocations.id }).from(vehicleAllocations)
          .where(and(
            eq(vehicleAllocations.driverEmployeeId, resolvedDriverId),
            inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
            lt(vehicleAllocations.startAt, endAt),
            gt(vehicleAllocations.endAt, startAt),
          ))
          .limit(1),
      ]);

      const licenceCodes = [
        ...codes.map((row) => row.code),
        ...String(driver.licenceClass || '').split(',').map((code) => code.trim()).filter(Boolean),
      ];

      driverCompliance = calculateDriverCompliance({
        employeeStatus: driver.employmentStatus,
        availabilityStatus: driver.availabilityStatus !== 'available' ? driver.availabilityStatus : driver.profileAvailability,
        driverStatus: driver.driverStatus,
        licenceStatus: driver.licenceStatus,
        licenceExpiry: driver.licenceExpiry,
        licenceCodes: Array.from(new Set(licenceCodes)),
        requiredLicenceClass: vehicle.requiredLicenceClass || undefined,
        professionalRequired: vehicle.professionalAuthorisationRequired,
        professionalVerified: professional[0]?.isVerified,
        professionalExpiry: professional[0]?.expiryDate,
        tripEndAt: endAt,
        hasScheduleConflict: !!driverConflict,
      });

      if (!['eligible', 'eligible_expiring_soon'].includes(driverCompliance.status)) {
        return NextResponse.json({
          error: 'Driver does not meet the compliance requirements for this vehicle and trip period.',
          compliance: driverCompliance,
        }, { status: 409 });
      }
    }

    const [existingRequestDriver] = resolvedDriverId
      ? await db.select({ id: requestDrivers.id })
          .from(requestDrivers)
          .where(and(eq(requestDrivers.requestId, resolvedRequestId), eq(requestDrivers.employeeId, resolvedDriverId)))
          .limit(1)
      : [undefined];

    const allocationId = randomUUID();
    const tripId = randomUUID();
    const now = new Date();

    await runAtomicMutations((tx) => {
      const mutations = [
        tx.insert(vehicleAllocations).values({
          id: allocationId,
          requestId: resolvedRequestId,
          vehicleId: resolvedVehicleId,
          driverEmployeeId: resolvedDriverId,
          startAt,
          endAt,
          state: 'confirmed',
          allocatedByUserId: userId,
          recommendationScore: recommendation?.topVariant?.score ?? null,
          createdAt: now,
          updatedAt: now,
        }),
        tx.insert(trips).values({
          id: tripId,
          tenantId,
          requestId: resolvedRequestId,
          allocationId,
          vehicleId: resolvedVehicleId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }),
        tx.update(transportRequests)
          .set({ assignedDriverEmployeeId: resolvedDriverId, status: 'vehicle_allocated', updatedAt: now })
          .where(and(eq(transportRequests.id, resolvedRequestId), eq(transportRequests.tenantId, tenantId))),
      ];

      if (resolvedDriverId) {
        mutations.push(
          tx.update(requestDrivers)
            .set({ isConfirmed: false })
            .where(eq(requestDrivers.requestId, resolvedRequestId)),
        );
        if (existingRequestDriver) {
          mutations.push(
            tx.update(requestDrivers)
              .set({ isConfirmed: true, licenceValidated: true, driverType: 'assigned' })
              .where(eq(requestDrivers.id, existingRequestDriver.id)),
          );
        } else {
          mutations.push(
            tx.insert(requestDrivers).values({
              requestId: resolvedRequestId,
              employeeId: resolvedDriverId,
              driverType: 'assigned',
              isConfirmed: true,
              licenceValidated: true,
            }),
          );
        }
      }
      return mutations;
    });

    const [[allocation], [trip]] = await Promise.all([
      db.select().from(vehicleAllocations).where(eq(vehicleAllocations.id, allocationId)).limit(1),
      db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId))).limit(1),
    ]);
    if (!allocation || !trip) {
      throw new Error('Atomic allocation creation committed but created records could not be reloaded');
    }

    let doc: Awaited<ReturnType<typeof onTripIssued>> | null = null;
    try {
      doc = await onTripIssued(allocation.id, tenantId, userId);
    } catch (documentError) {
      console.warn('[allocations] Post-commit document generation failed:', documentError);
    }

    try {
      await recordAuditEvent({
        tenantId,
        actorUserId: userId,
        action: resolvedDriverId ? 'allocation.created_with_driver' : 'allocation.created',
        entityType: 'allocation',
        entityId: allocation.id,
        summary: `Allocation created for ${foundReq.reference}: vehicle ${vehicle.licenceNumber}${resolvedDriverId ? `, driver ${resolvedDriverId.slice(0, 8)}` : ''}`,
        before: {},
        after: { vehicleId: resolvedVehicleId, driverEmployeeId: resolvedDriverId, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
      });
      await recordTenantRequestActivity({
        tenantId,
        requestId: foundReq.id,
        reference: foundReq.reference,
        stage: 'allocated',
        officeLabel: 'Transport office',
      });
    } catch (activityError) {
      console.warn('[allocations] Post-commit audit/activity failed:', activityError);
    }

    if (resolvedDriverId) {
      const [driverRow] = await db
        .select({ userId: employees.userId, email: employees.email, firstName: employees.firstName })
        .from(employees)
        .where(and(eq(employees.id, resolvedDriverId), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (driverRow) {
        try {
          if (driverRow.userId) {
            await createScopedNotifications({
              tenantId,
              recipientUserIds: [driverRow.userId],
              category: 'action_required',
              eventType: 'driver.assigned',
              title: 'You have been assigned as driver',
              body: `A vehicle (${vehicle.licenceNumber}) has been allocated to request ${foundReq.reference} from ${startAt.toLocaleDateString('en-NA')}. Review the trip and acknowledge before departure.`,
              entityType: 'allocation',
              entityId: allocation.id,
              actionUrl: '/dashboard/trips',
              workspace: 'driver',
            });
          }
          if (driverRow.email) {
            const { sendNotificationEmail } = await import('@/lib/email');
            await sendNotificationEmail({
              to: driverRow.email,
              type: 'allocation_created',
              title: '🚗 You have been assigned as driver',
              body: `A vehicle (${vehicle.licenceNumber}) has been allocated to request ${foundReq.reference} from ${startAt.toLocaleDateString('en-NA')}.`,
              actionUrl: '/dashboard/trips',
              recipientName: driverRow.firstName || 'Driver',
            });
          }
        } catch (notifyErr) {
          console.warn('[allocations] Driver notification failed:', notifyErr);
        }
      }
    }

    try {
      const { sendNotificationEmail } = await import('@/lib/email');
      const [requester] = await db
        .select({ email: employees.email, firstName: employees.firstName, lastName: employees.lastName })
        .from(transportRequests)
        .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
        .where(and(eq(transportRequests.id, resolvedRequestId), eq(transportRequests.tenantId, tenantId)))
        .limit(1);

      if (requester?.email) {
        await sendNotificationEmail({
          to: requester.email,
          type: 'allocation_created',
          title: '🚗 Vehicle Allocated',
          body: `A vehicle (${vehicle.licenceNumber}) has been allocated to your request ${foundReq.reference} from ${startAt.toLocaleDateString('en-NA')}.`,
          actionUrl: `/dashboard/requests/${foundReq.id}`,
          recipientName: requester.firstName || 'Requester',
        });
      }
    } catch (emailErr) {
      console.warn('[allocations] Allocation email failed:', emailErr);
    }

    return NextResponse.json({ allocation, trip, document: doc, recommendation, compliance: driverCompliance });
  } catch (error) {
    console.error('[allocations] POST failed:', error);
    const allocationDbError = describeAllocationDbError(error);
    if (allocationDbError) {
      return NextResponse.json({ error: allocationDbError.error }, { status: allocationDbError.status });
    }
    return NextResponse.json({ error: 'Failed to create allocation' }, { status: 500 });
  }
}
