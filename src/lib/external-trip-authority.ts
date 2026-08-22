import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
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
  ManualAuthorityNumberError,
  manualAuthorityNumberInUseError,
  maskLicenceNumber,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
  type ProvisionAuthorityResult,
} from '@/lib/trip-authority';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

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

async function selectAuthorityNumber(input: {
  tenantId: string;
  tenantCode: string;
  year: number;
  manualAuthorityNumber?: string | null;
  actorUserId: string;
}) {
  const manual = normaliseManualAuthorityNumber(input.manualAuthorityNumber);
  if (!manual) {
    return {
      authorityNumber: await nextAuthorityNumber(input.tenantId, input.tenantCode, input.year),
      authorityNumberSource: 'automatic' as const,
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
  if (duplicate) throw manualAuthorityNumberInUseError();

  return {
    authorityNumber: validated,
    authorityNumberSource: 'manual' as const,
    manualNumberOverrideReason: 'Physical Trip Authority number supplied at issue',
    manualNumberOverrideByUserId: input.actorUserId,
    manualNumberOverrideAt: new Date(),
  };
}

/**
 * Provision the canonical Trip Authority for an accepted external driver.
 *
 * External people never receive synthetic employee rows. Their active party,
 * verified licence and staff-recorded assignment acceptance are snapshotted in
 * the authority and in `trip_authorised_external_drivers`. The database safety
 * trigger is the final race-condition guard against a vehicle becoming unsafe
 * while final authorisation is being committed.
 */
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
        eq(transportRequests.tenantId, input.tenantId),
        eq(vehicleAllocations.id, input.allocationId),
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
  if (context.allocation.driverEmployeeId) {
    throw new Error('External Trip Authority provisioning requires an external-only driver assignment');
  }
  if (!context.request.workflowInstanceId) {
    throw new Error('The request has no workflow instance recording final authorisation');
  }

  const [
    [currentAllocation],
    [route],
    [resolvedAuthoriser],
    passengerRows,
    [externalDriver],
    [blockingDefect],
  ] = await Promise.all([
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
      .leftJoin(
        departments,
        and(eq(departments.id, employees.departmentId), eq(departments.tenantId, input.tenantId)),
      )
      .leftJoin(
        offices,
        and(eq(offices.id, employees.officeId), eq(offices.tenantId, input.tenantId)),
      )
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
        partyFirstName: externalParties.firstName,
        partyLastName: externalParties.lastName,
        organisationName: externalParties.organisationName,
        partyStatus: externalParties.status,
        licenceNumber: externalDriverLicences.licenceNumber,
        licenceClass: externalDriverLicences.licenceClass,
        licenceExpiry: externalDriverLicences.expiryDate,
        licenceVerificationStatus: externalDriverLicences.verificationStatus,
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
          eq(externalDriverLicences.tenantId, input.tenantId),
          eq(externalDriverLicences.externalPartyId, externalDriverAssignments.externalPartyId),
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
      .orderBy(desc(externalDriverAssignments.updatedAt), desc(externalDriverAssignments.assignedAt))
      .limit(1),
    db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, context.vehicle.id),
          eq(vehicleDefects.isBlocking, true),
          sql`${vehicleDefects.resolvedAt} IS NULL`,
        ),
      )
      .limit(1),
  ]);

  if (currentAllocation?.id !== input.allocationId) {
    throw new Error('Trip Authority requires the latest current confirmed allocation');
  }
  if (!resolvedAuthoriser?.userId || resolvedAuthoriser.userId !== input.actorUserId) {
    throw new Error('Trip Authority authoriser must match the recorded final workflow authoriser');
  }
  if (
    !externalDriver ||
    externalDriver.partyStatus !== 'active' ||
    externalDriver.licenceVerificationStatus !== 'verified' ||
    !externalDriver.acceptedAt
  ) {
    throw new Error('An accepted external driver with a verified licence is required');
  }
  const licenceExpiry = new Date(`${externalDriver.licenceExpiry}T23:59:59.999Z`);
  if (licenceExpiry < context.allocation.endAt) {
    throw new Error('The external driver licence must remain valid through the end of the trip');
  }
  if (
    context.vehicle.requiredLicenceClass &&
    !namibiaLicenceClassCovers(externalDriver.licenceClass, context.vehicle.requiredLicenceClass)
  ) {
    throw new Error(
      `External driver licence class ${externalDriver.licenceClass} does not cover vehicle requirement ${context.vehicle.requiredLicenceClass}`,
    );
  }
  if (context.vehicle.professionalAuthorisationRequired) {
    throw new Error('This vehicle requires professional driver authorisation and cannot use an external driver');
  }
  if (context.vehicle.status !== 'available' || blockingDefect) {
    throw new Error('The allocated vehicle is no longer safe and available for final authorisation');
  }
  const capacity = context.vehicle.seatedCapacity ?? 1;
  if (passengerRows.length + 1 > capacity) {
    throw new Error(`Passenger manifest exceeds the vehicle capacity of ${capacity}`);
  }

  const [existing] = await db
    .select()
    .from(tripAuthorities)
    .where(
      and(eq(tripAuthorities.tripId, input.tripId), eq(tripAuthorities.tenantId, input.tenantId)),
    )
    .limit(1);
  if (existing) {
    if (existing.requestId !== input.requestId || existing.allocationId !== input.allocationId) {
      throw new Error('The existing Trip Authority does not match the current operational assignment');
    }
    const [existingExternalDriver, existingVersion] = await Promise.all([
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
      existingExternalDriver?.externalPartyId !== externalDriver.externalPartyId ||
      existingExternalDriver?.licenceId !== externalDriver.licenceId ||
      !existingVersion
    ) {
      throw new Error(
        'An incomplete or mismatched external-driver Trip Authority already exists and requires administrative repair',
      );
    }
    return { authority: existing, verificationToken: null };
  }

  const rawToken = randomBytes(32).toString('base64url');
  const issuedAt = new Date();
  const numberSelection = await selectAuthorityNumber({
    tenantId: input.tenantId,
    tenantCode: context.tenantCode,
    year: context.allocation.startAt.getFullYear(),
    manualAuthorityNumber: input.manualAuthorityNumber,
    actorUserId: input.actorUserId,
  });
  const authorityId = randomUUID();
  const acceptanceData = {
    source: 'external_driver_assignment',
    assignmentId: externalDriver.assignmentId,
    externalPartyId: externalDriver.externalPartyId,
    acceptedAt: externalDriver.acceptedAt.toISOString(),
    acceptanceMethod: externalDriver.acceptanceMethod,
    acceptanceNote: externalDriver.acceptanceNote,
    acceptedDriverName: `${externalDriver.partyFirstName} ${externalDriver.partyLastName}`.trim(),
    organisationName: externalDriver.organisationName,
  };
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
    status: 'driver_accepted',
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
    acceptedAt: externalDriver.acceptedAt,
    acceptanceData,
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
      externalDriver: {
        externalPartyId: externalDriver.externalPartyId,
        name: `${externalDriver.partyFirstName} ${externalDriver.partyLastName}`.trim(),
        organisationName: externalDriver.organisationName,
        licenceClass: externalDriver.licenceClass,
        licenceExpiry: externalDriver.licenceExpiry,
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
    officeOrDepartment: passenger.employeeId
      ? [passenger.departmentName, passenger.officeName].filter(Boolean).join(' / ') || null
      : passenger.externalOrganisation,
    contactNumber: passenger.employeeId ? passenger.phone : passenger.externalPhone,
    passengerType: passenger.employeeId ? 'government_employee' : 'external_passenger',
    destination: route?.destinationName,
    reasonForTravel: context.request.purpose,
    addedByUserId: input.actorUserId,
  }));
  const externalDriverValues = {
    authorityId,
    externalPartyId: externalDriver.externalPartyId,
    externalDriverLicenceId: externalDriver.licenceId,
    driverType: 'primary',
    licenceNumberMasked: maskLicenceNumber(externalDriver.licenceNumber),
    licenceClass: externalDriver.licenceClass,
    licenceExpiry,
    acceptanceMethod: externalDriver.acceptanceMethod,
    acceptanceNote: externalDriver.acceptanceNote,
    acceptedAt: externalDriver.acceptedAt,
    authorisedByUserId: input.actorUserId,
    authorisedAt: issuedAt,
  } satisfies typeof tripAuthorisedExternalDrivers.$inferInsert;
  const snapshot = {
    ...authorityValues,
    passengerCount: passengerRows.length,
    primaryDriverExternalPartyId: externalDriver.externalPartyId,
    primaryDriverExternalLicenceId: externalDriver.licenceId,
  };

  try {
    await runAtomicMutations((tx) => {
      const mutations = [tx.insert(tripAuthorities).values(authorityValues)];
      if (passengerValues.length) mutations.push(tx.insert(tripAuthorityPassengers).values(passengerValues));
      mutations.push(
        tx.insert(tripAuthorisedExternalDrivers).values(externalDriverValues),
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
    const candidate = error as { code?: string };
    if (candidate.code !== '23505') throw error;

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
    if (raced) {
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
        racedDriver?.externalPartyId === externalDriver.externalPartyId &&
        racedDriver.licenceId === externalDriver.licenceId &&
        racedVersion
      ) {
        return { authority: raced, verificationToken: null };
      }
    }

    if (normaliseManualAuthorityNumber(input.manualAuthorityNumber)) {
      throw manualAuthorityNumberInUseError();
    }
    throw error;
  } catch (error) {
    if (error instanceof ManualAuthorityNumberError) throw error;
    throw error;
  }

  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.id, authorityId), eq(tripAuthorities.tenantId, input.tenantId)))
    .limit(1);
  if (!authority) throw new Error('External-driver Trip Authority could not be reloaded after provisioning');
  return { authority, verificationToken: rawToken };
}
