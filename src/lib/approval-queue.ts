import { and, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { workflowSteps } from '@/db/schema/workflows';
import type { PermissionCode } from '@/lib/permissions';

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
