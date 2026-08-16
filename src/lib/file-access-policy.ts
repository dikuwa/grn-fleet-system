import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';

const TENANT_ADMIN_BLOCKED_OPERATIONAL_PREFIXES = [
  'inspections/',
  'receipts/',
  'vehicles/',
  'trip-incidents/',
] as const;

/**
 * The generic file endpoint is intentionally narrower than FILE_VIEW itself.
 * FILE_VIEW lets a workspace read files through domain-specific routes, where
 * record scope can be checked. Only tenant-wide operational/read-only
 * workspaces may treat an arbitrary tenant object key as sufficient here.
 */
export function canUseGenericTenantFileKey(
  workspace: WorkspaceId,
  tenantRelativeKey: string,
): boolean {
  if (workspace === WorkspaceIds.TRANSPORT_ADMIN || workspace === WorkspaceIds.AUDIT) {
    return true;
  }

  if (workspace === WorkspaceIds.TENANT_ADMIN) {
    return !TENANT_ADMIN_BLOCKED_OPERATIONAL_PREFIXES.some((prefix) =>
      tenantRelativeKey.startsWith(prefix),
    );
  }

  return false;
}
