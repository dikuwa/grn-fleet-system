import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
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
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

export type TripReleaseGateStage = 'release' | 'authorisation' | 'issue';
export type TripReleaseBlockerCode =
  | 'trip_not_found'
  | 'workflow_not_ready'
  | 'transport_review_incomplete'
  | 'allocation_not_confirmed'
  | 'schedule_conflict'
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
  driverKind: 'internal' | 'external' | 'unassigned';
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

const successfulWorkflowResults = new Set([
  'approved',
  'released',
  'authorised',
  'acknowledged',
  'overridden',
]);

/**
 * Canonical operational release gate.
 *
 * Organisational routing decides whether a request progresses through its
 * configured approval chain. This service re-checks whether the current trip,
 * vehicle and driver evidence are operationally safe enough to release,
 * authorise or physically issue. It deliberately supports both employee drivers
 * and the isolated external-driver assignment model used by assisted external intake.
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
      workflowInstanceId: transportRequests.workflowInstanceId,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      allocationState: vehicleAllocations.state,
      allocationStartAt: vehicleAllocations.startAt,
      allocationEndAt: vehicleAllocations.endAt,
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
      driverKind: 'unassigned',
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

  // Re-check schedule eligibility at each operational release boundary. Allocation
  // creation already checks this, but another confirmed/released allocation can
  // be introduced later and must not silently invalidate the safety decision.
  const [vehicleConflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .where(
      and(
        ne(vehicleAllocations.id, trip.allocationId),
        eq(vehicleAllocations.vehicleId, trip.vehicleId),
        inArray(vehicleAllocations.state, ['confirmed', 'released']),
        lt(vehicleAllocations.startAt, trip.allocationEndAt),
        gt(vehicleAllocations.endAt, trip.allocationStartAt),
      ),
    )
    .limit(1);

  const [driverConflict] = trip.driverEmployeeId
    ? await db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .where(
          and(
            ne(vehicleAllocations.id, trip.allocationId),
            eq(vehicleAllocations.driverEmployeeId, trip.driverEmployeeId),
            inArray(vehicleAllocations.state, ['confirmed', 'released']),
            lt(vehicleAllocations.startAt, trip.allocationEndAt),
            gt(vehicleAllocations.endAt, trip.allocationStartAt),
          ),
        )
        .limit(1)
    : [];
  checks.scheduleConflictsClear = !vehicleConflict && !driverConflict;
  if (!checks.scheduleConflictsClear) {
    blockers.push({
      code: 'schedule_conflict',
      message: vehicleConflict
        ? 'The allocated vehicle now has another confirmed/released allocation that overlaps this trip.'
        : 'The assigned driver now has another confirmed/released allocation that overlaps this trip.',
    });
  }

  checks.vehicleAvailable = trip.vehicleStatus === 'available';
  if (!checks.vehicleAvailable) {
    blockers.push({
      code: 'vehicle_unavailable',
      message: `The allocated vehicle is not available (${trip.vehicleStatus}).`,
    });
  }

  if (input.stage === 'authorisation') {
    if (!trip.workflowInstanceId) {
      checks.workflowPrerequisitesComplete = false;
      blockers.push({
        code: 'workflow_not_ready',
        message: 'A submitted approval workflow is required before final authorisation.',
      });
    } else {
      const [[workflow], steps, actions] = await Promise.all([
        db
          .select({ id: workflowInstances.id, status: workflowInstances.status })
          .from(workflowInstances)
          .where(
            and(
              eq(workflowInstances.id, trip.workflowInstanceId),
              eq(workflowInstances.requestId, trip.requestId),
            ),
          )
          .limit(1),
        db
          .select()
          .from(workflowSteps)
          .innerJoin(workflowInstances, eq(workflowInstances.definitionId, workflowSteps.definitionId))
          .where(eq(workflowInstances.id, trip.workflowInstanceId))
          .orderBy(workflowSteps.stepOrder),
        db
          .select()
          .from(workflowActions)
          .where(eq(workflowActions.instanceId, trip.workflowInstanceId)),
      ]);
      const resolvedSteps = steps.map((row) => row.workflow_steps);
      const authoriseStep = resolvedSteps.find((step) => step.actionType === 'authorise');
      const priorSteps = authoriseStep
        ? resolvedSteps.filter(
            (step) => step.stepOrder < authoriseStep.stepOrder && step.actionType !== 'acknowledge',
          )
        : [];
      const completedStepOrders = new Set(
        actions
          .filter((action) => successfulWorkflowResults.has(action.result))
          .map((action) => action.stepOrder),
      );
      const workflowReady = Boolean(
        workflow &&
          workflow.status === 'active' &&
          authoriseStep &&
          priorSteps.every((step) => completedStepOrders.has(step.stepOrder)),
      );
      checks.workflowPrerequisitesComplete = workflowReady;
      if (!workflowReady) {
        blockers.push({
          code: 'workflow_not_ready',
          message: 'All required organisational approval steps before final authorisation must be completed.',
        });
      }
      const transportReview = priorSteps.find((step) => step.actionType === 'transport_review');
      const transportReviewComplete = Boolean(
        transportReview && completedStepOrders.has(transportReview.stepOrder),
      );
      checks.transportReviewComplete = transportReviewComplete;
      if (!transportReviewComplete) {
        blockers.push({
          code: 'transport_review_incomplete',
          message: 'Transport Officer Review must be completed before final authorisation.',
        });
      }
    }
  }

  const requiredThrough = trip.authorityValidUntil ?? trip.allocationEndAt;

  const [externalDriver] = !trip.driverEmployeeId
    ? await db
        .select({
          assignmentState: externalDriverAssignments.state,
          acceptedAt: externalDriverAssignments.acceptedAt,
          partyStatus: externalParties.status,
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
          ),
        )
        .where(
          and(
            eq(externalDriverAssignments.tripId, trip.id),
            eq(externalDriverAssignments.tenantId, input.tenantId),
            inArray(externalDriverAssignments.state, ['pending_acceptance', 'accepted']),
          ),
        )
        .orderBy(desc(externalDriverAssignments.assignedAt))
        .limit(1)
    : [];

  const driverKind: TripReleaseGateResult['driverKind'] = trip.driverEmployeeId
    ? 'internal'
    : externalDriver
      ? 'external'
      : 'unassigned';
  checks.driverAssigned = driverKind !== 'unassigned';
  if (driverKind === 'unassigned') {
    blockers.push({ code: 'driver_missing', message: 'An eligible driver must be assigned before release.' });
  }

  if (driverKind === 'internal' && trip.driverEmployeeId) {
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
      driverEvidence && licenceExpiry && licenceExpiry >= requiredThrough,
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
      const through = requiredThrough.toISOString().slice(0, 10);
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
  } else if (driverKind === 'external' && externalDriver) {
    const expiry = new Date(`${externalDriver.licenceExpiry}T23:59:59.999Z`);
    const licenceValid =
      externalDriver.partyStatus === 'active' &&
      externalDriver.licenceVerificationStatus === 'verified' &&
      Number.isFinite(expiry.getTime()) &&
      expiry >= requiredThrough;
    checks.driverLicenceValidThroughReturn = licenceValid;
    if (!licenceValid) {
      blockers.push({
        code: 'driver_licence_invalid',
        message: 'The external driver must have a verified licence valid through the requested return time.',
      });
    }
    const classCovers = Boolean(
      !trip.requiredLicenceClass ||
        namibiaLicenceClassCovers(externalDriver.licenceClass, trip.requiredLicenceClass),
    );
    checks.driverLicenceClassCoversVehicle = classCovers;
    if (!classCovers) {
      blockers.push({
        code: 'driver_licence_class_mismatch',
        message: `The external driver's licence does not cover the vehicle requirement ${trip.requiredLicenceClass ?? ''}.`.trim(),
      });
    }
    checks.professionalAuthorisationValid = !trip.professionalAuthorisationRequired;
    if (trip.professionalAuthorisationRequired) {
      blockers.push({
        code: 'professional_authorisation_invalid',
        message: 'This vehicle requires professional driving authorisation, which is not verified for the external driver.',
      });
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

    const acknowledged =
      driverKind === 'external'
        ? externalDriver?.assignmentState === 'accepted' && Boolean(externalDriver.acceptedAt)
        : Boolean(
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
      .select({
        id: vehicleInspections.id,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
      })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, input.tenantId),
          eq(vehicleInspections.tripId, trip.id),
          eq(vehicleInspections.vehicleId, trip.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    const departureInspectionPassed = Boolean(
      departureInspection?.status === 'completed' && departureInspection.overallPass === true,
    );
    checks.departureInspectionPassed = departureInspectionPassed;
    if (!departureInspectionPassed) {
      blockers.push({
        code: 'departure_inspection_missing',
        message: 'The latest pre-departure inspection for the allocated vehicle must be completed and passing before issue.',
      });
    }
  }

  return {
    allowed: blockers.length === 0,
    stage: input.stage,
    tripId: trip.id,
    requestId: input.requestId,
    driverKind,
    blockers,
    checks,
    requiredThrough: requiredThrough.toISOString(),
  };
}