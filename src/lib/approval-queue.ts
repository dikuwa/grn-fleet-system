import { and, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { workflowInstances, workflowSteps } from '@/db/schema/workflows';
import type { PermissionCode } from '@/lib/permissions';

/**
 * Predicate for active approvals visible to a user.
 *
 * The durable per-instance current assignment is authoritative whenever it is
 * present. This prevents a dynamically resolved acting/delegated holder from
 * sharing the same queue item with every user who happens to hold the same
 * permission, and prevents request-level reassignment from mutating the shared
 * workflow definition.
 *
 * The legacy fallbacks are intentionally restricted to instances whose current
 * assignment has not yet been persisted (for example an active instance that
 * existed before migration 0050 and has not been refreshed by the engine):
 *   1. explicit workflow-step assignment, then
 *   2. an unassigned permission-routed step.
 *
 * Once the engine persists currentAssignedUserId, only that user sees the
 * active item in the SQL queue/badge. Action-time authorization remains the
 * final security boundary.
 */
export function activeApprovalVisibleTo(
  userId: string,
  permissionCodes: readonly PermissionCode[],
): SQL {
  const persistedAssignedToMe = eq(workflowInstances.currentAssignedUserId, userId);

  const legacyExplicitAssignedToMe = and(
    isNull(workflowInstances.currentAssignedUserId),
    eq(workflowSteps.assignedUserId, userId),
  );

  if (permissionCodes.length === 0) {
    return or(persistedAssignedToMe, legacyExplicitAssignedToMe) ?? persistedAssignedToMe;
  }

  const legacyUnassignedWithPermission = and(
    isNull(workflowInstances.currentAssignedUserId),
    isNull(workflowSteps.assignedUserId),
    isNotNull(workflowSteps.requiredPermission),
    inArray(workflowSteps.requiredPermission, [...permissionCodes]),
  );

  return or(
    persistedAssignedToMe,
    legacyExplicitAssignedToMe,
    legacyUnassignedWithPermission,
  ) ?? persistedAssignedToMe;
}
