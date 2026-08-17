import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import {
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import {
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

export type TripReleaseGateStage = 'authorisation' | 'issue';
export type TripReleaseBlockerCode =
  | 'trip_not_found'
  | 'allocation_not_confirmed'
  | 'request_not_authorised'
  | 'authority_not_ready'
  | 'authority_document_stale'
  | 'vehicle_unavailable'
  | 'driver_missing'
  | 'driver_not_acknowledged'
  | 'driver_licence_invalid'
  | 'driver_licence_class_mismatch'
  | 'professional_authorisation_invalid'
  | 'departure_inspection_missing'
  | 'blocking_vehicle_defect';

export interface TripReleaseBlocker {
  code: TripReleaseBlockerCode;
  message: string;
}

export interface TripReleaseGateResult {
  allowed: boolean;
  stage: TripReleaseGateStage;
  tripId: string | null;
  requestId: string;
  blockers: TripReleaseBlocker[];
  checks: Record<string, boolean>;
  requiredThrough: string | null;
}

function snapshotAuthorityVersion(snapshotData: unknown): number | null {
  if (!snapshotData || typeof snapshotData !== 'object' || Array.isArray(snapshotData)) return null;
  const renderData = (snapshotData as Record<string, unknown>).renderData;
  if (!renderData || typeof renderData !== 'object' || Array.isArray(renderData)) return null;
  const raw = (renderData as Record<string, unknown>).documentVersion;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Canonical operational release gate.
 *
 * Approval routing answers whether the organisation approved the request.
 * This service answers whether the approved trip is operationally safe and
 * complete enough to progress to final authorisation / physical issue.
 * Consumers should render blocker messages rather than recreate these rules.
 */
export async function evaluateTripReleaseGate(input: {
  tenantId: string;
  requestId: string;
  stage: TripReleaseGateStage;
}): Promise<TripReleaseGateResult> {
  const db = getDb();
  const blockers: TripReleaseBlocker[] = [];
  const checks: Record<string, boolean> = {};

  const [trip] = await db
    .select({
      id: trips.id,
      requestId: trips.requestId,
      vehicleId: trips.vehicleId,
      allocationId: trips.allocationId,
      driverAcknowledgedAt: trips.driverAcknowledgedAt,
      driverAcknowledgedByEmployeeId: trips.driverAcknowledgedByEmployeeId,
      requestStatus: transportRequests.status,
      requestAssignedDriverEmployeeId: transportRequests.assignedDriverEmployeeId,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      allocationState: vehicleAllocations.state,
      authorityStatus: tripAuthorities.status,
      authorityDocumentVersion: tripAuthorities.documentVersion,
      authorityValidUntil: tripAuthorities.validUntil,
      vehicleStatus: vehicles.status,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
    })
    .from(trips)
    .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
    .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
    .leftJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .where(
      and(
        eq(trips.requestId, input.requestId),
        eq(trips.tenantId, input.tenantId),
        eq(transportRequests.tenantId, input.tenantId),
        eq(vehicles.tenantId, input.tenantId),
      ),
    )
    .orderBy(desc(trips.updatedAt), desc(trips.createdAt))
    .limit(1);

  if (!trip) {
    return {
      allowed: false,
      stage: input.stage,
      tripId: null,
      requestId: input.requestId,
      blockers: [{ code: 'trip_not_found', message: 'A current allocated trip is required before release.' }],
      checks: { tripFound: false },
      requiredThrough: null,
    };
  }

  checks.tripFound = true;
  checks.allocationConfirmed = trip.allocationState === 'confirmed';
  if (!checks.allocationConfirmed) {
    blockers.push({
      code: 'allocation_not_confirmed',
      message: `The current vehicle allocation must be confirmed (${trip.allocationState}).`,
    });
  }

  checks.vehicleAvailable = trip.vehicleStatus === 'available';
  if (!checks.vehicleAvailable) {
    blockers.push({
      code: 'vehicle_unavailable',
      message: `The allocated vehicle is not available (${trip.vehicleStatus}).`,
    });
  }

  checks.driverAssigned = Boolean(trip.driverEmployeeId);
  if (!trip.driverEmployeeId) {
    blockers.push({ code: 'driver_missing', message: 'An eligible driver must be assigned before release.' });
  }

  const requiredThrough = trip.authorityValidUntil ?? null;

  if (trip.driverEmployeeId) {
    const [driverEvidence] = await db
      .select({
        profileId: driverProfiles.id,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(employees.id, trip.driverEmployeeId),
          eq(employees.tenantId, input.tenantId),
          eq(employees.employmentStatus, 'active'),
          eq(driverProfiles.driverStatus, 'authorised'),
          eq(driverLicences.isActive, true),
          eq(driverLicences.isVerified, true),
          eq(driverLicences.verificationStatus, 'verified'),
        ),
      )
      .orderBy(desc(driverLicences.version))
      .limit(1);

    const licenceExpiry = driverEvidence?.expiryDate
      ? new Date(`${driverEvidence.expiryDate}T23:59:59.999Z`)
      : null;
    const licenceValidThrough = Boolean(
      driverEvidence && licenceExpiry && (!requiredThrough || licenceExpiry >= requiredThrough),
    );
    checks.driverLicenceValidThroughReturn = licenceValidThrough;
    if (!licenceValidThrough) {
      blockers.push({
        code: 'driver_licence_invalid',
        message: 'The assigned driver must have an active verified licence valid through the authorised return period.',
      });
    }

    const classCovers = Boolean(
      driverEvidence &&
        (!trip.requiredLicenceClass || namibiaLicenceClassCovers(driverEvidence.licenceClass, trip.requiredLicenceClass)),
    );
    checks.driverLicenceClassCoversVehicle = classCovers;
    if (!classCovers) {
      blockers.push({
        code: 'driver_licence_class_mismatch',
        message: `The assigned driver's licence does not cover the vehicle requirement ${trip.requiredLicenceClass ?? ''}.`.trim(),
      });
    }

    if (trip.professionalAuthorisationRequired && driverEvidence) {
      const through = (requiredThrough ?? new Date()).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const [professional] = await db
        .select({ id: driverProfessionalAuthorisations.id })
        .from(driverProfessionalAuthorisations)
        .where(
          and(
            eq(driverProfessionalAuthorisations.driverProfileId, driverEvidence.profileId),
            eq(driverProfessionalAuthorisations.isVerified, true),
            sql`${driverProfessionalAuthorisations.expiryDate} >= ${through}::date`,
            sql`(${driverProfessionalAuthorisations.validFrom} IS NULL OR ${driverProfessionalAuthorisations.validFrom} <= ${today}::date)`,
          ),
        )
        .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
        .limit(1);
      checks.professionalAuthorisationValid = Boolean(professional);
      if (!professional) {
        blockers.push({
          code: 'professional_authorisation_invalid',
          message: 'This vehicle requires verified professional driving authorisation valid through the trip period.',
        });
      }
    } else {
      checks.professionalAuthorisationValid = true;
    }
  }

  const [blockingDefect] = await db
    .select({ id: vehicleDefects.id })
    .from(vehicleDefects)
    .where(
      and(
        eq(vehicleDefects.vehicleId, trip.vehicleId),
        eq(vehicleDefects.isBlocking, true),
        isNull(vehicleDefects.resolvedAt),
      ),
    )
    .limit(1);
  checks.noBlockingVehicleDefect = !blockingDefect;
  if (blockingDefect) {
    blockers.push({
      code: 'blocking_vehicle_defect',
      message: 'Release is blocked by an unresolved safety-critical vehicle defect.',
    });
  }

  // Final authorisation requires the allocation and driver to be safe. Physical
  // issue adds document, acknowledgement and departure-inspection gates.
  if (input.stage === 'issue') {
    checks.requestAuthorised = trip.requestStatus === 'authorised';
    if (!checks.requestAuthorised) {
      blockers.push({ code: 'request_not_authorised', message: 'Final organisational authorisation is required before issue.' });
    }

    checks.authorityReady = trip.authorityStatus === 'ready_for_departure';
    if (!checks.authorityReady) {
      blockers.push({
        code: 'authority_not_ready',
        message: `The Trip Authority is not ready for departure (${trip.authorityStatus ?? 'missing'}).`,
      });
    }

    const [latestAuthorityDocument] = await db
      .select({
        status: generatedDocuments.status,
        documentVersion: generatedDocuments.documentVersion,
        snapshotData: generatedDocuments.snapshotData,
      })
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.tenantId, input.tenantId),
          eq(generatedDocuments.entityType, 'vehicle_allocation'),
          eq(generatedDocuments.entityId, trip.allocationId),
          eq(generatedDocuments.documentType, 'trip_authority'),
        ),
      )
      .orderBy(desc(generatedDocuments.documentVersion))
      .limit(1);
    const snapshotVersion = snapshotAuthorityVersion(latestAuthorityDocument?.snapshotData);
    const authorityDocumentCurrent = Boolean(
      latestAuthorityDocument &&
        latestAuthorityDocument.status === 'issued' &&
        snapshotVersion === trip.authorityDocumentVersion,
    );
    checks.authorityDocumentCurrent = authorityDocumentCurrent;
    if (!authorityDocumentCurrent) {
      blockers.push({
        code: 'authority_document_stale',
        message: 'The current Trip Authority must be generated and formally issued before vehicle issue.',
      });
    }

    const acknowledged = Boolean(
      trip.driverEmployeeId &&
        trip.requestAssignedDriverEmployeeId === trip.driverEmployeeId &&
        trip.driverAcknowledgedAt &&
        trip.driverAcknowledgedByEmployeeId === trip.driverEmployeeId,
    );
    checks.driverAcknowledged = acknowledged;
    if (!acknowledged) {
      blockers.push({
        code: 'driver_not_acknowledged',
        message: 'The currently assigned driver must acknowledge the final trip before issue.',
      });
    }

    const [departureInspection] = await db
      .select({ id: vehicleInspections.id })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, input.tenantId),
          eq(vehicleInspections.tripId, trip.id),
          eq(vehicleInspections.vehicleId, trip.vehicleId),
          eq(vehicleInspections.type, 'departure'),
          eq(vehicleInspections.status, 'completed'),
          eq(vehicleInspections.overallPass, true),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    checks.departureInspectionPassed = Boolean(departureInspection);
    if (!departureInspection) {
      blockers.push({
        code: 'departure_inspection_missing',
        message: 'A completed passing pre-departure inspection for the allocated vehicle is required before issue.',
      });
    }
  }

  return {
    allowed: blockers.length === 0,
    stage: input.stage,
    tripId: trip.id,
    requestId: input.requestId,
    blockers,
    checks,
    requiredThrough: requiredThrough?.toISOString() ?? null,
  };
}
