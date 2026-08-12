import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthoritySequences,
  tripAuthorityVersions,
  tripAuthorisedDrivers,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { requestPassengers, requestRoutes, transportRequests } from '@/db/schema/requests';
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
  in_progress: [
    'delayed',
    'route_deviation_pending_review',
    'incident_reported',
    'returned',
    'suspended',
  ],
  delayed: [
    'in_progress',
    'route_deviation_pending_review',
    'incident_reported',
    'returned',
    'suspended',
  ],
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

export function assertAuthorityTransition(current: string, next: TripAuthorityStatus): void {
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
 * Raised when a manually entered physical Trip Authority number cannot be used.
 * API routes map this to a 409 so the Transport Officer sees a human-readable
 * error instead of a generic server failure.
 */
export class ManualAuthorityNumberError extends Error {
  readonly code = 'MANUAL_AUTHORITY_NUMBER_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ManualAuthorityNumberError';
  }
}

export const MAX_MANUAL_AUTHORITY_NUMBER_LENGTH = 60;

/**
 * Trim and normalise a manually entered physical authority number. Empty and
 * whitespace-only input collapses to an empty string, which callers treat as
 * "no manual number supplied" (automatic generation).
 */
export function normaliseManualAuthorityNumber(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Validate a manual physical Trip Authority number. Physical paper authorities
 * do not follow the generated TA-YYYY-CODE-NNNNNN format, so validation only
 * guards against unusable input rather than imposing a specific shape.
 */
export function validateManualAuthorityNumber(value: string): string {
  if (!value) {
    throw new ManualAuthorityNumberError(
      'The physical Trip Authority number is empty. Leave the field blank to generate a number automatically.',
    );
  }
  if (value.length > MAX_MANUAL_AUTHORITY_NUMBER_LENGTH) {
    throw new ManualAuthorityNumberError(
      `The physical Trip Authority number is too long. Keep it under ${MAX_MANUAL_AUTHORITY_NUMBER_LENGTH} characters.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ManualAuthorityNumberError(
      'The physical Trip Authority number contains unsupported characters.',
    );
  }
  return value;
}

/**
 * Decide the canonical authority number for a trip.
 *
 * Deterministic selection rule:
 *   IF a manual physical number was supplied: use it (after validation).
 *   ELSE: use the generated system number.
 *
 * A manual number must not already exist for the same tenant, otherwise two
 * authorities would carry the same operational number. The tenant-scoped
 * uniqueness index on authority_number is the final backstop; this pre-check
 * exists so callers get a clear validation error rather than a unique-violation.
 */
async function selectAuthorityNumber(input: {
  tenantId: string;
  tenantCode: string;
  year: number;
  manualAuthorityNumber?: string | null;
  actorUserId: string;
}): Promise<{
  authorityNumber: string;
  authorityNumberSource: 'manual' | 'automatic';
  manualNumberOverrideReason: string | null;
  manualNumberOverrideByUserId: string | null;
  manualNumberOverrideAt: Date | null;
}> {
  const manual = normaliseManualAuthorityNumber(input.manualAuthorityNumber);
  if (!manual) {
    const authorityNumber = await nextAuthorityNumber(input.tenantId, input.tenantCode, input.year);
    return {
      authorityNumber,
      authorityNumberSource: 'automatic',
      manualNumberOverrideReason: null,
      manualNumberOverrideByUserId: null,
      manualNumberOverrideAt: null,
    };
  }

  const validated = validateManualAuthorityNumber(manual);
  const db = getDb();
  const [duplicate] = await db
    .select({ id: tripAuthorities.id })
    .from(tripAuthorities)
    .where(
      and(
        eq(tripAuthorities.tenantId, input.tenantId),
        eq(tripAuthorities.authorityNumber, validated),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new ManualAuthorityNumberError(
      'This Trip Authority number is already in use. Check the physical document number and try again.',
    );
  }

  return {
    authorityNumber: validated,
    authorityNumberSource: 'manual',
    manualNumberOverrideReason: 'Physical Trip Authority number supplied at issue',
    manualNumberOverrideByUserId: input.actorUserId,
    manualNumberOverrideAt: new Date(),
  };
}

export function assertTripAuthorityProvisioningInvariants(input: {
  tenantId: string;
  requestId: string;
  allocationId: string;
  tripId: string;
  actorUserId: string;
  trip: {
    id: string;
    tenantId: string;
    requestId: string;
    allocationId: string;
    vehicleId: string;
  };
  allocation: {
    id: string;
    requestId: string;
    vehicleId: string;
    driverEmployeeId: string | null;
    state: string;
    endAt: Date;
  };
  currentAllocationId: string | null;
  vehicle: { id: string; tenantId: string; seatedCapacity: number | null };
  driver: {
    employeeId: string;
    tenantId: string;
    licenceExpiry: string;
    verificationStatus: string;
  } | null;
  recordedAuthoriserUserId: string | null;
  passengerCount: number;
}) {
  const exactAssignment =
    input.trip.id === input.tripId &&
    input.trip.tenantId === input.tenantId &&
    input.trip.requestId === input.requestId &&
    input.trip.allocationId === input.allocationId &&
    input.allocation.id === input.allocationId &&
    input.allocation.requestId === input.requestId &&
    input.allocation.vehicleId === input.trip.vehicleId &&
    input.vehicle.id === input.trip.vehicleId &&
    input.vehicle.tenantId === input.tenantId;
  if (!exactAssignment) {
    throw new Error(
      'Trip Authority input does not match one exact tenant request allocation and vehicle',
    );
  }
  if (input.allocation.state !== 'confirmed' || input.currentAllocationId !== input.allocationId) {
    throw new Error('Trip Authority requires the latest current confirmed allocation');
  }
  if (
    !input.driver ||
    !input.allocation.driverEmployeeId ||
    input.driver.employeeId !== input.allocation.driverEmployeeId ||
    input.driver.tenantId !== input.tenantId ||
    input.driver.verificationStatus !== 'verified' ||
    new Date(`${input.driver.licenceExpiry}T23:59:59Z`) < input.allocation.endAt
  ) {
    throw new Error(
      'The allocated tenant driver requires a verified licence valid through the end of the trip',
    );
  }
  const capacity = input.vehicle.seatedCapacity ?? 1;
  if (input.passengerCount + 1 > capacity) {
    throw new Error(`Passenger manifest exceeds the vehicle capacity of ${capacity}`);
  }
  if (!input.recordedAuthoriserUserId || input.recordedAuthoriserUserId !== input.actorUserId) {
    throw new Error('Trip Authority authoriser must match the recorded final workflow authoriser');
  }
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
  /**
   * Optional number from the physical paper Trip Authority. When supplied it
   * becomes the canonical authority number; when omitted the standard system
   * number is generated automatically.
   */
  manualAuthorityNumber?: string | null;
}): Promise<ProvisionAuthorityResult> {
  const db = getDb();
  const [context] = await db
    .select({
      trip: trips,
      request: transportRequests,
      allocation: vehicleAllocations,
      vehicle: vehicles,
      tenantCode: tenants.code,
      tenantName: tenants.name,
      driverId: vehicleAllocations.driverEmployeeId,
    })
    .from(trips)
    .innerJoin(
      vehicleAllocations,
      and(
        eq(vehicleAllocations.id, trips.allocationId),
        eq(vehicleAllocations.requestId, trips.requestId),
      ),
    )
    .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, vehicleAllocations.vehicleId), eq(vehicles.id, trips.vehicleId)),
    )
    .innerJoin(tenants, eq(tenants.id, transportRequests.tenantId))
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.tenantId, input.tenantId),
        eq(trips.requestId, input.requestId),
        eq(trips.allocationId, input.allocationId),
        eq(transportRequests.id, input.requestId),
        eq(vehicleAllocations.id, input.allocationId),
        eq(transportRequests.tenantId, input.tenantId),
        eq(vehicleAllocations.state, 'confirmed'),
        eq(vehicles.tenantId, input.tenantId),
      ),
    )
    .limit(1);

  if (!context) {
    throw new Error(
      'The trip, request, current confirmed allocation, vehicle, and tenant do not form one valid operational assignment',
    );
  }
  if (!context.driverId)
    throw new Error('A driver must be assigned before issuing a Trip Authority');
  if (!context.request.workflowInstanceId) {
    throw new Error('The request has no workflow instance recording final authorisation');
  }

  const [[currentAllocation], [route], [resolvedAuthoriser], passengerRows, [driver]] =
    await Promise.all([
      db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .innerJoin(transportRequests, eq(transportRequests.id, vehicleAllocations.requestId))
        .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
        .where(
          and(
            eq(vehicleAllocations.requestId, input.requestId),
            eq(vehicleAllocations.state, 'confirmed'),
            eq(transportRequests.tenantId, input.tenantId),
            eq(vehicles.tenantId, input.tenantId),
          ),
        )
        .orderBy(desc(vehicleAllocations.updatedAt), desc(vehicleAllocations.createdAt))
        .limit(1),
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
        .where(
          and(
            eq(workflowInstances.id, context.request.workflowInstanceId),
            eq(workflowInstances.requestId, input.requestId),
            eq(workflowActions.actionType, 'authorise'),
            eq(workflowActions.result, 'authorised'),
          ),
        )
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
        .where(
          and(
            eq(requestPassengers.requestId, input.requestId),
            eq(requestPassengers.status, 'confirmed'),
          ),
        ),
      db
        .select({
          employeeId: employees.id,
          tenantId: employees.tenantId,
          employeeNumber: employees.employeeNumber,
          licenceNumber: driverLicences.licenceNumber,
          licenceClass: driverLicences.licenceClass,
          licenceExpiry: driverLicences.expiryDate,
          verificationStatus: driverLicences.verificationStatus,
        })
        .from(employees)
        .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
        .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
        .where(
          and(
            eq(employees.id, context.driverId),
            eq(employees.tenantId, input.tenantId),
            eq(driverLicences.verificationStatus, 'verified'),
          ),
        )
        .orderBy(desc(driverLicences.expiryDate))
        .limit(1),
    ]);

  assertTripAuthorityProvisioningInvariants({
    ...input,
    trip: {
      id: context.trip.id,
      tenantId: context.trip.tenantId,
      requestId: context.trip.requestId,
      allocationId: context.trip.allocationId,
      vehicleId: context.trip.vehicleId,
    },
    allocation: {
      id: context.allocation.id,
      requestId: context.allocation.requestId,
      vehicleId: context.allocation.vehicleId,
      driverEmployeeId: context.allocation.driverEmployeeId,
      state: context.allocation.state,
      endAt: context.allocation.endAt,
    },
    currentAllocationId: currentAllocation?.id ?? null,
    vehicle: {
      id: context.vehicle.id,
      tenantId: context.vehicle.tenantId,
      seatedCapacity: context.vehicle.seatedCapacity,
    },
    driver: driver ?? null,
    recordedAuthoriserUserId: resolvedAuthoriser?.userId ?? null,
    passengerCount: passengerRows.length,
  });

  const [existing] = await db
    .select()
    .from(tripAuthorities)
    .where(
      and(eq(tripAuthorities.tripId, input.tripId), eq(tripAuthorities.tenantId, input.tenantId)),
    )
    .limit(1);
  if (existing) {
    if (existing.requestId !== input.requestId || existing.allocationId !== input.allocationId) {
      throw new Error(
        'The existing Trip Authority does not match the requested operational assignment',
      );
    }
    const [existingDriver, existingVersion] = await Promise.all([
      db
        .select({ employeeId: tripAuthorisedDrivers.employeeId })
        .from(tripAuthorisedDrivers)
        .where(
          and(
            eq(tripAuthorisedDrivers.authorityId, existing.id),
            eq(tripAuthorisedDrivers.driverType, 'primary'),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ id: tripAuthorityVersions.id })
        .from(tripAuthorityVersions)
        .where(
          and(
            eq(tripAuthorityVersions.authorityId, existing.id),
            eq(tripAuthorityVersions.version, 1),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    if (existingDriver?.employeeId !== driver.employeeId || !existingVersion) {
      throw new Error(
        'An incomplete or mismatched Trip Authority already exists for this trip. It requires administrative repair before authorisation can continue.',
      );
    }
    return { authority: existing, verificationToken: null };
  }

  const [authorityForAllocation] = await db
    .select({ id: tripAuthorities.id, tripId: tripAuthorities.tripId })
    .from(tripAuthorities)
    .where(
      and(
        eq(tripAuthorities.tenantId, input.tenantId),
        eq(tripAuthorities.allocationId, input.allocationId),
      ),
    )
    .limit(1);
  if (authorityForAllocation) {
    throw new Error(
      `Allocation already has a Trip Authority for trip ${authorityForAllocation.tripId ?? 'unknown'}`,
    );
  }

  const rawToken = randomBytes(32).toString('base64url');
  const year = context.allocation.startAt.getFullYear();
  const numberSelection = await selectAuthorityNumber({
    tenantId: input.tenantId,
    tenantCode: context.tenantCode,
    year,
    manualAuthorityNumber: input.manualAuthorityNumber,
    actorUserId: input.actorUserId,
  });
  const authorityId = randomUUID();
  const issuedAt = new Date();
  const licenceExpiry = new Date(`${driver.licenceExpiry}T23:59:59Z`);
  const authorityValues = {
    id: authorityId,
    tenantId: input.tenantId,
    tripId: input.tripId,
    requestId: input.requestId,
    allocationId: input.allocationId,
    authorityNumber: numberSelection.authorityNumber,
    authorityNumberSource: numberSelection.authorityNumberSource,
    manualNumberOverrideReason: numberSelection.manualNumberOverrideReason,
    manualNumberOverrideByUserId: numberSelection.manualNumberOverrideByUserId,
    manualNumberOverrideAt: numberSelection.manualNumberOverrideAt,
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
    authorisedAt: resolvedAuthoriser.createdAt,
    authorisedByUserId: resolvedAuthoriser.userId,
    authoriserSnapshot: {
      employeeId: resolvedAuthoriser.employeeId,
      isActing: resolvedAuthoriser.isActing,
      capacity: resolvedAuthoriser.metadata?.resolvedCapacity,
      roleId: resolvedAuthoriser.metadata?.resolvedRoleId,
      authorisedAt: resolvedAuthoriser.createdAt.toISOString(),
    },
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

  try {
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
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;

    // A concurrent retry may win the unique trip constraint. Treat it as the
    // same idempotent operation only when the committed authority and its
    // mandatory child records exactly match this assignment.
    const [raced] = await db
      .select()
      .from(tripAuthorities)
      .where(
        and(
          eq(tripAuthorities.tripId, input.tripId),
          eq(tripAuthorities.tenantId, input.tenantId),
          eq(tripAuthorities.requestId, input.requestId),
          eq(tripAuthorities.allocationId, input.allocationId),
        ),
      )
      .limit(1);
    if (!raced) {
      // A manual number may have collided on the tenant+number unique index
      // for a different trip (TOCTOU between pre-check and insert).
      if (normaliseManualAuthorityNumber(input.manualAuthorityNumber)) {
        throw new ManualAuthorityNumberError(
          'This Trip Authority number is already in use. Check the physical document number and try again.',
        );
      }
      throw error;
    }
    const [[racedDriver], [racedVersion]] = await Promise.all([
      db
        .select({ employeeId: tripAuthorisedDrivers.employeeId })
        .from(tripAuthorisedDrivers)
        .where(
          and(
            eq(tripAuthorisedDrivers.authorityId, raced.id),
            eq(tripAuthorisedDrivers.driverType, 'primary'),
          ),
        )
        .limit(1),
      db
        .select({ id: tripAuthorityVersions.id })
        .from(tripAuthorityVersions)
        .where(
          and(
            eq(tripAuthorityVersions.authorityId, raced.id),
            eq(tripAuthorityVersions.version, 1),
          ),
        )
        .limit(1),
    ]);
    if (racedDriver?.employeeId !== driver.employeeId || !racedVersion) {
      if (normaliseManualAuthorityNumber(input.manualAuthorityNumber)) {
        throw new ManualAuthorityNumberError(
          'This Trip Authority number is already in use. Check the physical document number and try again.',
        );
      }
      throw error;
    }
    return { authority: raced, verificationToken: null };
  }

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
    .where(
      and(eq(tripAuthorities.id, input.authorityId), eq(tripAuthorities.tenantId, input.tenantId)),
    )
    .limit(1);
  if (!authority) throw new Error('Trip Authority not found');
  assertAuthorityTransition(authority.status, input.next);

  const [updated] = await db
    .update(tripAuthorities)
    .set({ ...input.patch, status: input.next, updatedAt: new Date() })
    .where(
      and(
        eq(tripAuthorities.id, input.authorityId),
        eq(tripAuthorities.version, authority.version),
      ),
    )
    .returning();
  if (!updated) throw new Error('Trip Authority changed concurrently; refresh and try again');
  return updated;
}
