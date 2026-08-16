import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';
import type { UploadCategory } from '@/lib/storage';

const PERSONAL_UPLOAD_CATEGORIES = new Set<UploadCategory>(['document', 'avatar']);
const TENANT_ADMIN_BLOCKED_OPERATIONAL_CATEGORIES = new Set<UploadCategory>([
  'inspection',
  'receipt',
  'vehicle',
  'trip-incident',
]);

/**
 * Keep the generic upload endpoint aligned with the active dashboard workspace.
 * A stored FILE_UPLOAD grant must not let a user write evidence into an
 * operational namespace that their current workspace does not operate.
 */
export function isUploadCategoryAllowedInWorkspace(
  workspace: WorkspaceId,
  category: UploadCategory,
): boolean {
  if (workspace === WorkspaceIds.PERSONAL) {
    return PERSONAL_UPLOAD_CATEGORIES.has(category);
  }

  if (workspace === WorkspaceIds.TENANT_ADMIN) {
    return !TENANT_ADMIN_BLOCKED_OPERATIONAL_CATEGORIES.has(category);
  }

  return true;
}
