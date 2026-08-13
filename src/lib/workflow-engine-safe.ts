import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  employees,
  rolePermissions,
  roles,
  transportRequests,
  workflowActions,
} from '@/db/schema';
import { resolveRoleHolder } from '@/lib/employee-lifecycle';
import {
  createScopedNotifications,
  resolveActionNotifications,
} from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';
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
  override async initializeForRequest(requestId: string, tenantId: string) {
    const result = await super.initializeForRequest(requestId, tenantId);
    if (!result.ok) return result;

    // The base initializer may have emitted its first assignment notification
    // before conflict-safe runtime resolution was applied. If that assignment
    // is conflicted, resolve the unsafe notification and issue the action alert
    // only to the safe current-step recipient(s).
    const status = await this.getWorkflowStatus(result.instance.id);
    const config = (status?.currentStep?.config || {}) as Record<string, unknown>;
    if (status?.currentStep && config.conflictSafeResolution === true) {
      await resolveActionNotifications({
        tenantId,
        entityType: 'workflow_instance',
        entityId: result.instance.id,
        eventTypes: ['approval_assigned'],
      });

      const recipients = await this.getCurrentStepRecipients(result.instance.id, tenantId);
      if (recipients.length > 0) {
        await createScopedNotifications({
          tenantId,
          recipientUserIds: recipients,
          category: 'action_required',
          eventType: 'approval_assigned',
          title: `Action Required — ${status.currentStep.label}`,
          body: 'A newly submitted transport request is awaiting your action.',
          entityType: 'workflow_instance',
          entityId: result.instance.id,
          actionUrl: `/dashboard/approvals/${result.instance.id}`,
          workspace: WorkspaceIds.APPROVER,
          workflowStage: String(status.currentStep.stepOrder),
          priority: 'high',
        });
      }
    }

    return result;
  }

  override async getWorkflowStatus(instanceId: string) {
    const status = await super.getWorkflowStatus(instanceId);
    if (!status?.currentStep || status.instance.status !== 'active') return status;

    const currentStep = status.currentStep;
    if (!currentStep.requiredPermission || currentStep.actionType === 'acknowledge') {
      return status;
    }

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

    const excludeEmployeeIds = [
      request.requesterEmployeeId,
      request.travellerEmployeeId,
    ].filter((id): id is string => Boolean(id));
    const excludeUserIds = [request.requesterUserId].filter((id): id is string => Boolean(id));

    // Convert request participant employee IDs to user IDs as well so
    // permission-routed queues/reminders can hide the conflicted traveller,
    // not merely reject them later at action time.
    if (excludeEmployeeIds.length > 0) {
      const participantUsers = await db
        .select({ userId: employees.userId })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, request.tenantId),
            inArray(employees.id, excludeEmployeeIds),
          ),
        );
      for (const participant of participantUsers) {
        if (participant.userId) excludeUserIds.push(participant.userId);
      }
    }

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

    const uniqueExcludeUserIds = [...new Set(excludeUserIds)];
    const uniqueExcludeEmployeeIds = [...new Set(excludeEmployeeIds)];
    const assignedUserId = currentStep.assignedUserId;

    // A genuinely unassigned permission-routed step is valid. Attach the
    // separation-of-duty exclusions so queue/reminder callers can suppress
    // conflicted users while still allowing every other qualified user.
    if (!assignedUserId) {
      const unassigned = {
        ...currentStep,
        config: {
          ...(currentStep.config || {}),
          conflictExcludedUserIds: uniqueExcludeUserIds,
          conflictExcludedEmployeeIds: uniqueExcludeEmployeeIds,
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

    let assignedIsConflicted = uniqueExcludeUserIds.includes(assignedUserId);
    if (!assignedIsConflicted && uniqueExcludeEmployeeIds.length > 0) {
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
        assignedEmployee && uniqueExcludeEmployeeIds.includes(assignedEmployee.id),
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
        excludeUserIds: uniqueExcludeUserIds,
        excludeEmployeeIds: uniqueExcludeEmployeeIds,
      });
      if (!holder?.userId) continue;

      const replacement = {
        ...currentStep,
        assignedUserId: holder.userId,
        config: {
          ...(currentStep.config || {}),
          conflictSafeResolution: true,
          conflictedAssignedUserId: assignedUserId,
          conflictExcludedUserIds: uniqueExcludeUserIds,
          conflictExcludedEmployeeIds: uniqueExcludeEmployeeIds,
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
        conflictExcludedUserIds: uniqueExcludeUserIds,
        conflictExcludedEmployeeIds: uniqueExcludeEmployeeIds,
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

  override async getCurrentStepRecipients(instanceId: string, tenantId: string): Promise<string[]> {
    const recipients = await super.getCurrentStepRecipients(instanceId, tenantId);
    if (recipients.length === 0) return recipients;

    const status = await this.getWorkflowStatus(instanceId);
    const config = (status?.currentStep?.config || {}) as Record<string, unknown>;
    const excluded = Array.isArray(config.conflictExcludedUserIds)
      ? config.conflictExcludedUserIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (excluded.length === 0) return recipients;
    const excludedSet = new Set(excluded);
    return recipients.filter((userId) => !excludedSet.has(userId));
  }
}
