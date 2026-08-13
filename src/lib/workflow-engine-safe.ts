import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  employees,
  rolePermissions,
  roles,
  transportRequests,
  workflowActions,
} from '@/db/schema';
import { resolveRoleHolder } from '@/lib/employee-lifecycle';
import { WorkflowEngine as BaseWorkflowEngine } from './workflow-engine';

export * from './workflow-engine';

/**
 * Conflict-safe facade over the legacy workflow engine.
 *
 * The base engine resolves role holders dynamically from workflow definitions.
 * A role holder can also be the requester/traveller (or, for final
 * authorisation, the release officer). The decision services correctly block
 * those self-conflicts, but an explicit conflicted assignment then prevents
 * every other eligible officer from acting.
 *
 * This facade only changes an assignment when the resolved assignee is
 * actually conflicted. It keeps valid explicit assignments untouched, tries a
 * conflict-free acting/substantive holder for the same permission, and falls
 * back to an unassigned permission-routed step when no safe explicit holder is
 * available. Action-time RBAC and separation-of-duty checks remain authoritative.
 */
export class WorkflowEngine extends BaseWorkflowEngine {
  override async getWorkflowStatus(instanceId: string) {
    const status = await super.getWorkflowStatus(instanceId);
    if (!status?.currentStep || status.instance.status !== 'active') return status;

    const currentStep = status.currentStep;
    if (!currentStep.requiredPermission || currentStep.actionType === 'acknowledge') {
      return status;
    }

    const assignedUserId = currentStep.assignedUserId;
    if (!assignedUserId) return status;

    const db = getDb();
    const [request] = await db
      .select({
        tenantId: transportRequests.tenantId,
        requesterUserId: transportRequests.requesterUserId,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        travellerEmployeeId: transportRequests.travellerEmployeeId,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, status.instance.requestId))
      .limit(1);
    if (!request) return status;

    const excludeUserIds = [request.requesterUserId].filter((id): id is string => Boolean(id));
    const excludeEmployeeIds = [
      request.requesterEmployeeId,
      request.travellerEmployeeId,
    ].filter((id): id is string => Boolean(id));

    // Final authorisation also enforces release/authorise separation of duty.
    if (currentStep.actionType === 'authorise') {
      const [releaseAction] = await db
        .select({ actorUserId: workflowActions.actorUserId })
        .from(workflowActions)
        .where(
          and(
            eq(workflowActions.instanceId, instanceId),
            eq(workflowActions.actionType, 'release'),
          ),
        )
        .limit(1);
      if (releaseAction?.actorUserId) excludeUserIds.push(releaseAction.actorUserId);
    }

    let assignedIsConflicted = excludeUserIds.includes(assignedUserId);
    if (!assignedIsConflicted && excludeEmployeeIds.length > 0) {
      const [assignedEmployee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, request.tenantId),
            eq(employees.userId, assignedUserId),
          ),
        )
        .limit(1);
      assignedIsConflicted = Boolean(
        assignedEmployee && excludeEmployeeIds.includes(assignedEmployee.id),
      );
    }

    if (!assignedIsConflicted) return status;

    const roleRows = await db
      .select({ roleId: roles.id })
      .from(roles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          eq(roles.tenantId, request.tenantId),
          eq(rolePermissions.permissionCode, currentStep.requiredPermission),
        ),
      );

    const capability =
      currentStep.actionType === 'authorise'
        ? 'sign'
        : currentStep.actionType === 'release'
          ? 'allocate'
          : 'approve';

    for (const role of roleRows) {
      const holder = await resolveRoleHolder({
        tenantId: request.tenantId,
        roleId: role.roleId,
        requireCapability: capability,
        excludeUserIds,
        excludeEmployeeIds,
      });
      if (!holder?.userId) continue;

      const replacement = {
        ...currentStep,
        assignedUserId: holder.userId,
        config: {
          ...(currentStep.config || {}),
          conflictSafeResolution: true,
          conflictedAssignedUserId: assignedUserId,
          resolvedRoleId: role.roleId,
          resolvedEmployeeId: holder.employeeId,
          resolvedCapacity: holder.capacity,
          isActing: holder.isActing,
          delegationId: 'delegationId' in holder ? holder.delegationId : null,
        },
      };

      return {
        ...status,
        currentStep: replacement,
        definition: {
          ...status.definition,
          steps: status.definition.steps.map((step) =>
            step.stepOrder === replacement.stepOrder ? replacement : step,
          ),
        },
      };
    }

    // No conflict-free explicit holder exists. Deliberately remove the unsafe
    // assignment so the existing permission-based queue can surface the item
    // to other qualified users; action-time separation-of-duty still rejects
    // the requester/traveller/release officer themselves.
    const unassigned = {
      ...currentStep,
      assignedUserId: null,
      config: {
        ...(currentStep.config || {}),
        conflictSafeResolution: true,
        conflictedAssignedUserId: assignedUserId,
        assignmentFallback: 'permission_routed',
      },
    };

    return {
      ...status,
      currentStep: unassigned,
      definition: {
        ...status.definition,
        steps: status.definition.steps.map((step) =>
          step.stepOrder === unassigned.stepOrder ? unassigned : step,
        ),
      },
    };
  }
}
