import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthoritySequences,
  tripAuthorityVersions,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { tripAuthorisedExternalDrivers } from '@/db/schema/external-authority-drivers';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { requestPassengers, requestRoutes, transportRequests } from '@/db/schema/requests';
import { departments, employees, offices } from '@/db/schema/people';
import { tenants } from '@/db/schema/tenants';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { runAtomicMutations } from '@/lib/db-atomic';
import {
  manualAuthorityNumberInUseError,
  maskLicenceNumber,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
  type ProvisionAuthorityResult,
} from '@/lib/trip-authority';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

function hashVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}

async function chooseAuthorityNumber(input: {
  tenantId: string;
  tenantCode: string;
  year: number;
  manualAuthorityNumber?: string | null;
  actorUserId: string;
}) {
  const db = getDb();
  const manual = normaliseManualAuthorityNumber(input.manualAuthorityNumber);
  if (manual) {
    const authorityNumber = validateManualAuthorityNumber(manual);
    const [duplicate] = await db
      .select({ id: tripAuthorities.id })
      .from(tripAuthorities)
      .where(
        and(
          eq(tripAuthorities.tenantId, input.tenantId),
          eq(tripAuthorities.authorityNumber, authorityNumber),
        ),
      )
      .limit(1);
    if (duplicate) throw manualAuthorityNumberInUseError();
    return {
      authorityNumber,
      authorityNumberSource: 'manual' as const,
      manualNumberOverrideReason: 'Physical Trip Authority number supplied at issue',
      manualNumberOverrideByUserId: input.actorUserId,
      manualNumberOverrideAt: new Date(),
    };
  }

  const [sequence] = await db
    .insert(tripAuthoritySequences)
    .values({ tenantId: input.tenantId, sequenceYear: input.year, currentValue: 1 })
    .onConflictDoUpdate({
      target: [tripAuthoritySequences.tenantId, tripAuthoritySequences.sequenceYear],
      set: {
        currentValue: sql`${tripAuthoritySequences.currentValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: tripAuthoritySequences.currentValue });
  const code = input.tenantCode.replace(/[^a-z0-9]/gi, '').toUpperCase() || 'GRN';
  return {
    authorityNumber: `TA-${input.year}-${code}-${String(sequence.value).padStart(6, '0')}`,
    authorityNumberSource: 'automatic' as const,
    manualNumberOverrideReason: null,
    manualNumberOverrideByUserId: null,
    manualNumberOverrideAt: null,
  };
}

export async function provisionExternalTripAuthority(input: {
  tripId: string;
  tenantId: string;
  requestId: string;
  allocationId: string;
  actorUserId: string;
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
    })
    .from(trips)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .innerJoin(tenants, eq(tenants.id, transportRequests.tenantId))
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.tenantId, input.tenantId),
        eq(trips.requestId, input.requestId),
        eq(trips.allocationId, input.allocationId),
        eq(vehicleAllocations.id, input.allocationId),
        eq(vehicleAllocations.requestId, input.requestId),
        eq(vehicleAllocations.state, 'confirmed'),
        eq(transportRequests.tenantId, input.tenantId),
        eq(vehicles.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  if (!context || context.allocation.driverEmployeeId) {
    throw new Error('A current confirmed external-only operational assignment is required');
  }
  if (!context.request.workflowInstanceId) {
    throw new Error('The request has no workflow instance recording final authorisation');
  }

  const [[currentAllocation], [route], [authoriser], passengers, [driver], [blockingDefect]] =
    await Promise.all([
      db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .where(
          and(
            eq(vehicleAllocations.requestId, input.requestId),
            eq(vehicleAllocations.state, 'confirmed'),
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
          externalOrganisation: requestPassengers.externalOrganisation,
          externalPhone: requestPassengers.externalPhone,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
          phone: employees.phone,
          departmentName: departments.name,
          officeName: offices.name,
        })
        .from(requestPassengers)
        .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(offices, eq(offices.id, employees.officeId))
        .where(
          and(
            eq(requestPassengers.requestId, input.requestId),
            eq(requestPassengers.status, 'confirmed'),
          ),
        ),
      db
        .select({
          assignmentId: externalDriverAssignments.id,
          externalPartyId: externalDriverAssignments.externalPartyId,
          licenceId: externalDriverAssignments.licenceId,
          acceptedAt: externalDriverAssignments.acceptedAt,
          acceptanceMethod: externalDriverAssignments.acceptanceMethod,
          acceptanceNote: externalDriverAssignments.acceptanceNote,
          firstName: externalParties.firstName,
          lastName: externalParties.lastName,
          organisationName: externalParties.organisationName,
          partyStatus: externalParties.status,
          licenceNumber: externalDriverLicences.licenceNumber,
          licenceClass: externalDriverLicences.licenceClass,
          licenceExpiry: externalDriverLicences.expiryDate,
          verificationStatus: externalDriverLicences.verificationStatus,
        })
        .from(externalDriverAssignments)
        .innerJoin(
          externalParties,
          and(
            eq(externalParties.id, externalDriverAssignments.externalPartyId),
            eq(externalParties.tenantId, input.tenantId),
          ),
        )
        .innerJoin(
          externalDriverLicences,
          and(
            eq(externalDriverLicences.id, externalDriverAssignments.licenceId),
            eq(externalDriverLicences.externalPartyId, externalDriverAssignments.externalPartyId),
            eq(externalDriverLicences.tenantId, input.tenantId),
          ),
        )
        .where(
          and(
            eq(externalDriverAssignments.tenantId, input.tenantId),
            eq(externalDriverAssignments.requestId, input.requestId),
            eq(externalDriverAssignments.allocationId, input.allocationId),
            eq(externalDriverAssignments.tripId, input.tripId),
            eq(externalDriverAssignments.state, 'accepted'),
          ),
        )
        .orderBy(desc(externalDriverAssignments.updatedAt))
        .limit(1),
      db
        .select({ id: vehicleDefects.id })
        .from(vehicleDefects)
        .where(
          and(
            eq(vehicleDefects.vehicleId, context.vehicle.id),
            eq(vehicleDefects.isBlocking, true),
            isNull(vehicleDefects.resolvedAt),
          ),
        )
        .limit(1),
    ]);

  if (currentAllocation?.id !== input.allocationId) {
    throw new Error('Trip Authority requires the latest current confirmed allocation');
  }
  if (!authoriser?.userId || authoriser.userId !== input.actorUserId) {
    throw new Error('Trip Authority authoriser must match the recorded final workflow authoriser');
  }
  if (!driver || driver.partyStatus !== 'active' || driver.verificationStatus !== 'verified' || !driver.acceptedAt) {
    throw new Error('An accepted active external driver with a verified licence is required');
  }
  const licenceExpiry = new Date(`${driver.licenceExpiry}T23:59:59.999Z`);
  if (licenceExpiry < context.allocation.endAt) {
    throw new Error('The external driver licence must remain valid through the full trip period');
  }
  if (
    context.vehicle.requiredLicenceClass &&
    !namibiaLicenceClassCovers(driver.licenceClass, context.vehicle.requiredLicenceClass)
  ) {
    throw new Error('The external driver licence class does not cover the allocated vehicle');
  }
  if (context.vehicle.professionalAuthorisationRequired) {
    throw new Error('The allocated vehicle requires professional driving authorisation');
  }
  if (context.vehicle.status !== 'available' || blockingDefect) {
    throw new Error('The allocated vehicle is no longer safe and available for final authorisation');
  }
  if (passengers.length + 1 > (context.vehicle.seatedCapacity ?? 1)) {
    throw new Error(`Passenger manifest exceeds the vehicle capacity of ${context.vehicle.seatedCapacity ?? 1}`);
  }

  const [existing] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.tripId, input.tripId), eq(tripAuthorities.tenantId, input.tenantId)))
    .limit(1);
  if (existing) {
    const [existingDriver, existingVersion] = await Promise.all([
      db
        .select({
          externalPartyId: tripAuthorisedExternalDrivers.externalPartyId,
          licenceId: tripAuthorisedExternalDrivers.externalDriverLicenceId,
        })
        .from(tripAuthorisedExternalDrivers)
        .where(
          and(
            eq(tripAuthorisedExternalDrivers.authorityId, existing.id),
            eq(tripAuthorisedExternalDrivers.driverType, 'primary'),
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
    if (
      existing.requestId !== input.requestId ||
      existing.allocationId !== input.allocationId ||
      existingDriver?.externalPartyId !== driver.externalPartyId ||
      existingDriver?.licenceId !== driver.licenceId ||
      !existingVersion
    ) {
      throw new Error('An incomplete or mismatched external-driver Trip Authority requires administrative repair');
    }
    return { authority: existing, verificationToken: null };
  }

  const rawToken = randomBytes(32).toString('base64url');
  const issuedAt = new Date();
  const number = await chooseAuthorityNumber({
    tenantId: input.tenantId,
    tenantCode: context.tenantCode,
    year: context.allocation.startAt.getFullYear(),
    manualAuthorityNumber: input.manualAuthorityNumber,
    actorUserId: input.actorUserId,
  });
  const authorityId = randomUUID();
  const driverName = `${driver.firstName} ${driver.lastName}`.trim();
  const acceptanceData = {
    source: 'external_driver_assignment',
    assignmentId: driver.assignmentId,
    externalPartyId: driver.externalPartyId,
    acceptedAt: driver.acceptedAt.toISOString(),
    acceptanceMethod: driver.acceptanceMethod,
    acceptanceNote: driver.acceptanceNote,
    acceptedDriverName: driverName,
  };
  const authorityValues = {
    id: authorityId,
    tenantId: input.tenantId,
    tripId: input.tripId,
    requestId: input.requestId,
    allocationId: input.allocationId,
    authorityNumber: number.authorityNumber,
    authorityNumberSource: number.authorityNumberSource,
    manualNumberOverrideReason: number.manualNumberOverrideReason,
    manualNumberOverrideByUserId: number.manualNumberOverrideByUserId,
    manualNumberOverrideAt: number.manualNumberOverrideAt,
    verificationTokenHash: hashVerificationToken(rawToken),
    status: 'driver_accepted',
    validFrom: context.allocation.startAt,
    validUntil: context.allocation.endAt,
    purpose: context.request.purpose,
    origin: route?.originName,
    destination: route?.destinationName,
    approvedRoute: route ? [route.originName, route.destinationName].filter(Boolean).join(' → ') : null,
    specialAuthorityGranted: context.request.specialAuthorityApproved === true,
    specialConditions: context.request.specialAuthorityReason,
    acceptedAt: driver.acceptedAt,
    acceptanceData,
    issuedAt,
    authorisedAt: authoriser.createdAt,
    authorisedByUserId: authoriser.userId,
    authoriserSnapshot: {
      employeeId: authoriser.employeeId,
      isActing: authoriser.isActing,
      capacity: authoriser.metadata?.resolvedCapacity,
      roleId: authoriser.metadata?.resolvedRoleId,
      authorisedAt: authoriser.createdAt.toISOString(),
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
      },
      externalDriver: {
        externalPartyId: driver.externalPartyId,
        name: driverName,
        organisationName: driver.organisationName,
        licenceClass: driver.licenceClass,
        licenceExpiry: driver.licenceExpiry,
      },
      verificationToken: rawToken,
    },
  } satisfies typeof tripAuthorities.$inferInsert;

  const passengerValues = passengers.map((passenger) => ({
    authorityId,
    employeeId: passenger.employeeId,
    fullName: passenger.employeeId
      ? `${passenger.firstName ?? ''} ${passenger.lastName ?? ''}`.trim()
      : passenger.externalName || 'External passenger',
    employeeNumber: passenger.employeeNumber,
    officeOrDepartment: passenger.employeeId
      ? [passenger.departmentName, passenger.officeName].filter(Boolean).join(' / ') || null
      : passenger.externalOrganisation,
    contactNumber: passenger.employeeId ? passenger.phone : passenger.externalPhone,
    passengerType: passenger.employeeId ? 'government_employee' : 'external_passenger',
    destination: route?.destinationName,
    reasonForTravel: context.request.purpose,
    addedByUserId: input.actorUserId,
  }));
  const driverValues = {
    authorityId,
    externalPartyId: driver.externalPartyId,
    externalDriverLicenceId: driver.licenceId,
    driverType: 'primary',
    licenceNumberMasked: maskLicenceNumber(driver.licenceNumber),
    licenceClass: driver.licenceClass,
    licenceExpiry,
    acceptanceMethod: driver.acceptanceMethod,
    acceptanceNote: driver.acceptanceNote,
    acceptedAt: driver.acceptedAt,
    authorisedByUserId: input.actorUserId,
    authorisedAt: issuedAt,
  } satisfies typeof tripAuthorisedExternalDrivers.$inferInsert;
  const snapshot = {
    ...authorityValues,
    passengerCount: passengers.length,
    primaryDriverExternalPartyId: driver.externalPartyId,
    primaryDriverExternalLicenceId: driver.licenceId,
  };

  try {
    await runAtomicMutations((tx) => {
      const mutations = [tx.insert(tripAuthorities).values(authorityValues)];
      if (passengerValues.length) mutations.push(tx.insert(tripAuthorityPassengers).values(passengerValues));
      mutations.push(
        tx.insert(tripAuthorisedExternalDrivers).values(driverValues),
        tx.insert(tripAuthorityVersions).values({
          authorityId,
          version: 1,
          status: 'driver_accepted',
          snapshot,
          reason: 'Initial Trip Authority issue for accepted external driver',
          createdByUserId: input.actorUserId,
        }),
      );
      return mutations;
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
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
      if (normaliseManualAuthorityNumber(input.manualAuthorityNumber)) throw manualAuthorityNumberInUseError();
      throw error;
    }
    const [racedDriver, racedVersion] = await Promise.all([
      db
        .select({
          externalPartyId: tripAuthorisedExternalDrivers.externalPartyId,
          licenceId: tripAuthorisedExternalDrivers.externalDriverLicenceId,
        })
        .from(tripAuthorisedExternalDrivers)
        .where(
          and(
            eq(tripAuthorisedExternalDrivers.authorityId, raced.id),
            eq(tripAuthorisedExternalDrivers.driverType, 'primary'),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ id: tripAuthorityVersions.id })
        .from(tripAuthorityVersions)
        .where(
          and(
            eq(tripAuthorityVersions.authorityId, raced.id),
            eq(tripAuthorityVersions.version, 1),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    if (
      racedDriver?.externalPartyId !== driver.externalPartyId ||
      racedDriver?.licenceId !== driver.licenceId ||
      !racedVersion
    ) {
      if (normaliseManualAuthorityNumber(input.manualAuthorityNumber)) throw manualAuthorityNumberInUseError();
      throw error;
    }
    return { authority: raced, verificationToken: null };
  }

  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.id, authorityId), eq(tripAuthorities.tenantId, input.tenantId)))
    .limit(1);
  if (!authority) throw new Error('External-driver Trip Authority could not be reloaded after provisioning');
  return { authority, verificationToken: rawToken };
}
