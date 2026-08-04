import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import {
  requestActivities,
  requestAttachments,
  requestDrivers,
  requestPassengers,
  requestRevisions,
  requestRoutes,
  transportRequests,
} from '@/db/schema/requests';
import { vehicleAllocations } from '@/db/schema/trips';
import {
  emergencyOverrides,
  workflowActions,
  workflowDefinitions,
  workflowInstances,
  workflowSteps,
} from '@/db/schema/workflows';
import type { PermissionCode } from '@/lib/permissions';

export async function getApprovalDetail(input: {
  instanceId: string;
  tenantId: string;
  userId: string;
  permissionCodes: PermissionCode[];
}) {
  const db = getDb();
  const instance = await db
    .select({
      id: workflowInstances.id,
      status: workflowInstances.status,
      currentStepOrder: workflowInstances.currentStepOrder,
      createdAt: workflowInstances.createdAt,
      updatedAt: workflowInstances.updatedAt,
      requestId: workflowInstances.requestId,
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      definitionVersion: workflowDefinitions.version,
      requestReference: transportRequests.reference,
      requestScope: transportRequests.scope,
      requestStatus: transportRequests.status,
      requestPurpose: transportRequests.purpose,
      requestDepartment: transportRequests.department,
      requesterEmployeeId: transportRequests.requesterEmployeeId,
      requesterUserId: transportRequests.requesterUserId,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      requesterEmployeeNumber: employees.employeeNumber,
      requesterJobTitle: employees.jobTitle,
      requesterDirectorate: employees.directorate,
      driverPreference: transportRequests.driverPreference,
      preferredDriverEmployeeId: transportRequests.preferredDriverEmployeeId,
      assignedDriverEmployeeId: transportRequests.assignedDriverEmployeeId,
      specialAuthorityRequired: transportRequests.specialAuthorityRequired,
      specialAuthorityReason: transportRequests.specialAuthorityReason,
      specialAuthorityApproved: transportRequests.specialAuthorityApproved,
      specialRequirements: transportRequests.specialRequirements,
      vehicleRequirements: transportRequests.vehicleRequirements,
      employeeConfirmationStatus: transportRequests.employeeConfirmationStatus,
      totalAuthorisedKilometres: transportRequests.totalAuthorisedKilometres,
      revision: transportRequests.revision,
      submittedAt: transportRequests.submittedAt,
      requestCreatedAt: transportRequests.createdAt,
      requestUpdatedAt: transportRequests.updatedAt,
    })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(
      and(
        eq(workflowInstances.id, input.instanceId),
        eq(transportRequests.tenantId, input.tenantId),
      ),
    )
    .then((rows) => rows[0] ?? null);

  if (!instance) return null;

  const [
    steps,
    actions,
    activities,
    passengers,
    drivers,
    routes,
    attachments,
    allocation,
    revision,
    override,
  ] = await Promise.all([
    db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.definitionId, instance.definitionId))
      .orderBy(asc(workflowSteps.stepOrder)),
    db
      .select({
        id: workflowActions.id,
        stepOrder: workflowActions.stepOrder,
        actionType: workflowActions.actionType,
        result: workflowActions.result,
        comment: workflowActions.comment,
        isActing: workflowActions.isActing,
        actorUserId: workflowActions.actorUserId,
        actorName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        createdAt: workflowActions.createdAt,
      })
      .from(workflowActions)
      .leftJoin(employees, eq(workflowActions.actorEmployeeId, employees.id))
      .where(eq(workflowActions.instanceId, input.instanceId))
      .orderBy(asc(workflowActions.createdAt)),
    db
      .select()
      .from(requestActivities)
      .where(eq(requestActivities.requestId, instance.requestId))
      .orderBy(asc(requestActivities.startDate)),
    db
      .select({
        id: requestPassengers.id,
        employeeId: requestPassengers.employeeId,
        externalName: requestPassengers.externalName,
        externalOrganisation: requestPassengers.externalOrganisation,
        travellerRole: requestPassengers.travellerRole,
        reasonForTravel: requestPassengers.reasonForTravel,
        employeeName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        employeeNumber: employees.employeeNumber,
      })
      .from(requestPassengers)
      .leftJoin(employees, eq(requestPassengers.employeeId, employees.id))
      .where(eq(requestPassengers.requestId, instance.requestId))
      .orderBy(asc(requestPassengers.createdAt)),
    db
      .select({
        id: requestDrivers.id,
        employeeId: requestDrivers.employeeId,
        driverType: requestDrivers.driverType,
        isConfirmed: requestDrivers.isConfirmed,
        licenceValidated: requestDrivers.licenceValidated,
        employeeName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        employeeNumber: employees.employeeNumber,
      })
      .from(requestDrivers)
      .leftJoin(employees, eq(requestDrivers.employeeId, employees.id))
      .where(eq(requestDrivers.requestId, instance.requestId))
      .orderBy(asc(requestDrivers.sortOrder)),
    db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, instance.requestId))
      .orderBy(asc(requestRoutes.createdAt)),
    db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, instance.requestId))
      .orderBy(desc(requestAttachments.createdAt)),
    db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        vehicleId: vehicleAllocations.vehicleId,
        seatedCapacity: vehicles.seatedCapacity,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
        vehicleCategory: vehicles.vehicleCategory,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(eq(vehicleAllocations.requestId, instance.requestId))
      .orderBy(desc(vehicleAllocations.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(requestRevisions)
      .where(eq(requestRevisions.requestId, instance.requestId))
      .orderBy(desc(requestRevisions.revision))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(emergencyOverrides)
      .where(eq(emergencyOverrides.instanceId, input.instanceId))
      .then((rows) => rows[0] ?? null),
  ]);

  const currentStep = steps.find((step) => step.stepOrder === instance.currentStepOrder) ?? null;
  const hasStepPermission = Boolean(
    currentStep?.requiredPermission &&
    input.permissionCodes.includes(currentStep.requiredPermission as PermissionCode),
  );
  const canViewActive = Boolean(
    instance.status === 'active' &&
    currentStep &&
    (currentStep.assignedUserId === input.userId || hasStepPermission),
  );
  const canAct = Boolean(
    canViewActive &&
    currentStep &&
    (currentStep.assignedUserId === input.userId ||
      (!currentStep.assignedUserId && hasStepPermission)),
  );
  const actedPreviously = actions.some((action) => action.actorUserId === input.userId);
  if (!canViewActive && !actedPreviously) return null;

  return {
    instance,
    currentStep,
    nextStep: steps.find((step) => step.stepOrder === instance.currentStepOrder + 1) ?? null,
    steps,
    actions,
    activities,
    passengers,
    drivers,
    routes,
    attachments,
    allocation,
    revision,
    override,
    canAct,
  };
}
