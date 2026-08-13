import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { workflowInstances, workflowSteps } from '@/db/schema/workflows';
import type { PermissionCode } from '@/lib/permissions';
import { WorkflowEngine } from '@/lib/workflow-engine';

/**
 * Predicate for the active approvals a user should see in their queue.
 *
 * Mirrors the runtime authorization model used by `getApprovalDetail.canAct`
 * and the workflow engine: an active approval belongs to a user when the
 * current step is explicitly assigned to them, OR when the step carries no
 * assignment but they hold the required permission.
 *
 * The engine resolves step holders at runtime (`resolveRoleHolder` — acting
 * delegations, availability, dynamic drivers) without persisting them, so the
 * raw `assignedUserId` column alone would leave the queue empty for every
 * permission-routed step. The `acknowledge` step is always unassigned in the
 * DB and is therefore surfaced through the permission branch too — the action
 * API still enforces the allocated-driver check.
 *
 * @param userId          the signed-in user id
 * @param permissionCodes permission codes held by the user (may be empty)
 */
export function activeApprovalVisibleTo(
  userId: string,
  permissionCodes: readonly PermissionCode[],
): SQL {
  const assignedToMe = eq(workflowSteps.assignedUserId, userId);
  if (permissionCodes.length === 0) return assignedToMe;

  const unassignedWithPermission = and(
    isNull(workflowSteps.assignedUserId),
    isNotNull(workflowSteps.requiredPermission),
    inArray(workflowSteps.requiredPermission, [...permissionCodes]),
  );
  return or(assignedToMe, unassignedWithPermission) ?? assignedToMe;
}

/**
 * Resolve the active approval instances a user can actually act on.
 *
 * Definition-level `assignedUserId` values are only a candidate hint: the
 * workflow engine may replace them with the current substantive or acting
 * holder at runtime. Candidate selection therefore permits a matching step
 * permission even when a stale static assignment is non-null, then the final
 * filter applies the runtime assignment. This is not permission fan-out; an
 * explicit runtime holder always wins and unrelated holders are excluded.
 */
export async function resolveActionableApprovalInstanceIds(input: {
  tenantId: string;
  userId: string;
  permissionCodes: readonly PermissionCode[];
  db?: ReturnType<typeof getDb>;
}): Promise<string[]> {
  const db = input.db ?? getDb();
  const assignedToUser = eq(workflowSteps.assignedUserId, input.userId);
  const candidateVisibility = input.permissionCodes.length > 0
    ? or(
        assignedToUser,
        and(
          isNotNull(workflowSteps.requiredPermission),
          inArray(workflowSteps.requiredPermission, [...input.permissionCodes]),
        ),
      )
    : assignedToUser;
  const candidates = await db
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .innerJoin(
      workflowSteps,
      and(
        eq(workflowSteps.definitionId, workflowInstances.definitionId),
        eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
      ),
    )
    .where(
      and(
        eq(transportRequests.tenantId, input.tenantId),
        eq(workflowInstances.status, 'active'),
        ne(workflowSteps.actionType, 'acknowledge'),
        candidateVisibility,
      ),
    );

  if (candidates.length === 0) return [];

  const engine = new WorkflowEngine({ db });
  const permissionSet = new Set<PermissionCode>(input.permissionCodes);
  const statuses = await Promise.all(
    candidates.map(async ({ id }) => ({ id, status: await engine.getWorkflowStatus(id) })),
  );

  return statuses
    .filter(({ status }) => {
      const step = status?.currentStep;
      if (!status || status.instance.status !== 'active' || !step) return false;
      if (step.actionType === 'acknowledge') return false;

      const config = (step.config || {}) as Record<string, unknown>;
      const excludedUserIds = Array.isArray(config.conflictExcludedUserIds)
        ? config.conflictExcludedUserIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [];
      if (excludedUserIds.includes(input.userId)) return false;

      if (step.assignedUserId) return step.assignedUserId === input.userId;
      return Boolean(
        step.requiredPermission &&
          permissionSet.has(step.requiredPermission as PermissionCode),
      );
    })
    .map(({ id }) => id);
}
