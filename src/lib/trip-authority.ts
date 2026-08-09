import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthoritySequences,
  tripAuthorityVersions,
  tripAuthorisedDrivers,
  vehicleAllocations,
} from '@/db/schema/trips';
import {
  requestPassengers,
  requestRoutes,
  transportRequests,
} from '@/db/schema/requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { tenants } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { runAtomicMutations } from '@/lib/db-atomic';

export const tripAuthorityStatuses = [
  'draft',
  'awaiting_approval',
  'approved',
  'vehicle_allocated',
  'driver_assigned',
  'awaiting_driver_acceptance',
  'driver_accepted',
  'awaiting_pre_trip_inspection',
  'ready_for_departure',
  'in_progress',
  'delayed',
  'route_deviation_pending_review',
  'incident_reported',
  'returned',
  'awaiting_arrival_inspection',
  'awaiting_reconciliation',
  'awaiting_receipt_verification',
  'completed',
  'closed',
  'rejected',
  'cancelled',
  'expired',
  'suspended',
  'superseded',
] as const;

export type TripAuthorityStatus = (typeof tripAuthorityStatuses)[number];

const transitionMap: Partial<Record<TripAuthorityStatus, TripAuthorityStatus[]>> = {
  draft: ['awaiting_approval', 'approved', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['vehicle_allocated', 'driver_assigned', 'cancelled', 'suspended'],
  vehicle_allocated: ['driver_assigned', 'cancelled', 'suspended'],
  driver_assigned: ['awaiting_driver_acceptance', 'cancelled', 'suspended'],
  awaiting_driver_acceptance: ['driver_accepted', 'rejected', 'cancelled', 'expired', 'suspended'],
  driver_accepted: ['awaiting_pre_trip_inspection', 'cancelled', 'expired', 'suspended'],
  awaiting_pre_trip_inspection: ['ready_for_departure', 'cancelled', 'expired', 'suspended'],
  ready_for_departure: ['in_progress', 'cancelled', 'expired', 'suspended'],
  in_progress: ['delayed', 'route_deviation_pending_review', 'incident_reported', 'returned', 'suspended'],
  delayed: ['in_progress', 'route_deviation_pending_review', 'incident_reported', 'returned', 'suspended'],
  route_deviation_pending_review: ['in_progress', 'incident_reported', 'returned', 'suspended'],
  incident_reported: ['in_progress', 'returned', 'suspended'],
  returned: ['awaiting_arrival_inspection'],
  awaiting_arrival_inspection: ['awaiting_reconciliation'],
  awaiting_reconciliation: ['awaiting_receipt_verification', 'completed'],
  awaiting_receipt_verification: ['awaiting_reconciliation', 'completed'],
  completed: ['closed'],
  suspended: ['awaiting_driver_acceptance', 'ready_for_departure', 'in_progress', 'cancelled'],
};

export function canTransitionAuthority(
  current: TripAuthorityStatus,
  next: TripAuthorityStatus,
): boolean {
  return transitionMap[current]?.includes(next) ?? false;
}

export function assertAuthorityTransition(
  current: string,
  next: TripAuthorityStatus,
): void {
  if (!tripAuthorityStatuses.includes(current as TripAuthorityStatus)) {
    throw new Error(`Unknown Trip Authority status "${current}"`);
  }
  if (!canTransitionAuthority(current as TripAuthorityStatus, next)) {
    throw new Error(`Trip Authority cannot move from "${current}" to "${next}"`);
  }
}

export function maskLicenceNumber(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

async function nextAuthorityNumber(tenantId: string, tenantCode: string, year: number) {
  const db = getDb();
  const [sequence] = await db
    .insert(tripAuthoritySequences)
    .values({ tenantId, sequenceYear: year, currentValue: 1 })
    .onConflictDoUpdate({
      target: [tripAuthoritySequences.tenantId, tripAuthoritySequences.sequenceYear],
      set: {
        currentValue: sql`${tripAuthoritySequences.currentValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: tripAuthoritySequences.currentValue });

  const safeCode = tenantCode.replace(/[^a-z0-9]/gi, '').toUpperCase() || 'GRN';
  return `TA-${year}-${safeCode}-${String(sequence.value).padStart(6, '0')}`;
}

export interface ProvisionAuthorityResult {
  authority: typeof tripAuthorities.$inferSelect;
  verificationToken: string | null;
}

/**
 * Provision the one canonical authority for an operational trip.
 *
 * All business preconditions are validated before the first authority row is
 * inserted. The authority, passenger manifest, authorised driver and immutable
 * version then commit in one transaction/batch so a failed final-authorisation
 * attempt can never leave a partial authority that makes a later retry appear
 * successful.
 */
export async function provisionTripAuthority(input: {
  tripId: string;
  tenantId: string;
  requestId: string;
  allocationId: string;
  actorUserId: string;
}): Promise<ProvisionAuthorityResult> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.tripId, input.tripId), eq(tripAuthorities.tenantId, input.tenantId)))
    .limit(1);
  if (existing) {
    const [existingDriver, existingVersion] = await Promise.all([
      db
        .select({ id: tripAuthorisedDrivers.id })
        .from(tripAuthorisedDrivers)
        .where(and(
          eq(tripAuthorisedDrivers.authorityId, existing.id),
          eq(tripAuthorisedDrivers.driverType, 'primary'),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ id: tripAuthorityVersions.id })
        .from(tripAuthorityVersions)
        .where(and(
          eq(tripAuthorityVersions.authorityId, existing.id),
          eq(tripAuthorityVersions.version, 1),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    if (!existingDriver || !existingVersion) {
      throw new Error(
        'An incomplete Trip Authority already exists for this trip. It requires administrative repair before authorisation can continue.',
      );
    }
    return { authority: existing, verificationToken: null };
  }

  const [context] = await db
    .select({
      request: transportRequests,
      allocation: vehicleAllocations,
      vehicle: vehicles,
      tenantCode: tenants.code,
      tenantName: tenants.name,
      driverId: vehicleAllocations.driverEmployeeId,
    })
    .from(transportRequests)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.requestId, transportRequests.id))
    .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
    .innerJoin(tenants, eq(tenants.id, transportRequests.tenantId))
    .where(and(
      eq(transportRequests.id, input.requestId),
      eq(vehicleAllocations.id, input.allocationId),
      eq(transportRequests.tenantId, input.tenantId),
    ))
    .limit(1);

  if (!context) throw new Error('Approved request, allocation, or vehicle was not found');
  if (!context.driverId) throw new Error('A driver must be assigned before issuing a Trip Authority');

  const [[route], [resolvedAuthoriser], passengerRows, [driver]] = await Promise.all([
    db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, input.requestId))
      .orderBy(desc(requestRoutes.createdAt))
      .limit(1),
    db
      .select({
        userId: workflowActions.actorUserId,
        employeeId: workflowActions.actorEmployeeId,
        isActing: workflowActions.isActing,
        metadata: workflowActions.metadata,
        createdAt: workflowActions.createdAt,
      })
      .from(workflowActions)
      .innerJoin(workflowInstances, eq(workflowInstances.id, workflowActions.instanceId))
      .where(and(
        eq(workflowInstances.requestId, input.requestId),
        eq(workflowActions.actionType, 'authorise'),
      ))
      .orderBy(desc(workflowActions.createdAt))
      .limit(1),
    db
      .select({
        employeeId: requestPassengers.employeeId,
        externalName: requestPassengers.externalName,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        phone: employees.phone,
        jobTitle: employees.jobTitle,
      })
      .from(requestPassengers)
      .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
      .where(and(
        eq(requestPassengers.requestId, input.requestId),
        eq(requestPassengers.status, 'confirmed'),
      )),
    db
      .select({
        employeeId: employees.id,
        employeeNumber: employees.employeeNumber,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        licenceExpiry: driverLicences.expiryDate,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(and(
        eq(employees.id, context.driverId),
        eq(employees.tenantId, input.tenantId),
        eq(driverLicences.verificationStatus, 'verified'),
      ))
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1),
  ]);

  const capacity = context.vehicle.seatedCapacity ?? 1;
  if (passengerRows.length + 1 > capacity) {
    throw new Error(`Passenger manifest exceeds the vehicle capacity of ${capacity}`);
  }
  if (!driver || new Date(`${driver.licenceExpiry}T23:59:59Z`) < context.allocation.endAt) {
    throw new Error('The assigned driver requires a verified licence valid through the end of the trip');
  }

  const rawToken = randomBytes(32).toString('base64url');
  const year = context.allocation.startAt.getFullYear();
  const authorityNumber = await nextAuthorityNumber(input.tenantId, context.tenantCode, year);
  const authorityId = randomUUID();
  const issuedAt = new Date();
  const licenceExpiry = new Date(`${driver.licenceExpiry}T23:59:59Z`);
  const authorityValues = {
    id: authorityId,
    tenantId: input.tenantId,
    tripId: input.tripId,
    requestId: input.requestId,
    allocationId: input.allocationId,
    authorityNumber,
    verificationTokenHash: tokenHash(rawToken),
    status: 'awaiting_driver_acceptance',
    validFrom: context.allocation.startAt,
    validUntil: context.allocation.endAt,
    purpose: context.request.purpose,
    origin: route?.originName,
    destination: route?.destinationName,
    approvedRoute: route
      ? [route.originName, route.destinationName].filter(Boolean).join(' → ')
      : null,
    specialAuthorityGranted: context.request.specialAuthorityApproved === true,
    specialConditions: context.request.specialAuthorityReason,
    issuedAt,
    authorisedAt: resolvedAuthoriser?.createdAt || null,
    authorisedByUserId: resolvedAuthoriser?.userId || input.actorUserId,
    authoriserSnapshot: resolvedAuthoriser
      ? {
          employeeId: resolvedAuthoriser.employeeId,
          isActing: resolvedAuthoriser.isActing,
          capacity: resolvedAuthoriser.metadata?.resolvedCapacity,
          roleId: resolvedAuthoriser.metadata?.resolvedRoleId,
          authorisedAt: resolvedAuthoriser.createdAt.toISOString(),
        }
      : null,
    documentVersion: 1,
    version: 1,
    data: {
      tenantName: context.tenantName,
      requestReference: context.request.reference,
      authorisedKilometres: context.request.totalAuthorisedKilometres,
      vehicle: {
        id: context.vehicle.id,
        registration: context.vehicle.licenceNumber,
        registerNumber: context.vehicle.vehicleRegisterNumber,
        make: context.vehicle.make,
        model: context.vehicle.model,
        colour: context.vehicle.colour,
        fuelType: context.vehicle.fuelType,
        seatedCapacity: context.vehicle.seatedCapacity,
        licenceExpiryDate: context.vehicle.licenceExpiryDate,
      },
      verificationToken: rawToken,
    },
  } satisfies typeof tripAuthorities.$inferInsert;

  const passengerValues = passengerRows.map((passenger) => ({
    authorityId,
    employeeId: passenger.employeeId,
    fullName: passenger.employeeId
      ? `${passenger.firstName ?? ''} ${passenger.lastName ?? ''}`.trim()
      : passenger.externalName || 'External passenger',
    employeeNumber: passenger.employeeNumber,
    officeOrDepartment: passenger.jobTitle,
    contactNumber: passenger.phone,
    passengerType: passenger.employeeId ? 'government_employee' : 'external_passenger',
    destination: route?.destinationName,
    reasonForTravel: context.request.purpose,
    addedByUserId: input.actorUserId,
  }));
  const driverValues = {
    authorityId,
    employeeId: driver.employeeId,
    driverType: 'primary',
    employeeNumber: driver.employeeNumber,
    licenceNumberMasked: maskLicenceNumber(driver.licenceNumber),
    licenceClass: driver.licenceClass,
    licenceExpiry,
    authorisedByUserId: input.actorUserId,
    authorisedAt: issuedAt,
  } satisfies typeof tripAuthorisedDrivers.$inferInsert;
  const snapshot = {
    ...authorityValues,
    passengerCount: passengerRows.length,
    primaryDriverEmployeeId: driver.employeeId,
  };

  await runAtomicMutations((tx) => {
    const mutations = [tx.insert(tripAuthorities).values(authorityValues)];
    if (passengerValues.length) {
      mutations.push(tx.insert(tripAuthorityPassengers).values(passengerValues));
    }
    mutations.push(
      tx.insert(tripAuthorisedDrivers).values(driverValues),
      tx.insert(tripAuthorityVersions).values({
        authorityId,
        version: 1,
        status: 'awaiting_driver_acceptance',
        snapshot,
        reason: 'Initial Trip Authority issue',
        createdByUserId: input.actorUserId,
      }),
    );
    return mutations;
  });

  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.id, authorityId), eq(tripAuthorities.tenantId, input.tenantId)))
    .limit(1);
  if (!authority) throw new Error('Trip Authority could not be reloaded after provisioning');
  return { authority, verificationToken: rawToken };
}

export async function setAuthorityStatus(input: {
  authorityId: string;
  tenantId: string;
  next: TripAuthorityStatus;
  patch?: Partial<typeof tripAuthorities.$inferInsert>;
}) {
  const db = getDb();
  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(
      eq(tripAuthorities.id, input.authorityId),
      eq(tripAuthorities.tenantId, input.tenantId),
    ))
    .limit(1);
  if (!authority) throw new Error('Trip Authority not found');
  assertAuthorityTransition(authority.status, input.next);

  const [updated] = await db
    .update(tripAuthorities)
    .set({ ...input.patch, status: input.next, updatedAt: new Date() })
    .where(and(
      eq(tripAuthorities.id, input.authorityId),
      eq(tripAuthorities.version, authority.version),
    ))
    .returning();
  if (!updated) throw new Error('Trip Authority changed concurrently; refresh and try again');
  return updated;
}
