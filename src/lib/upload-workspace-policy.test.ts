import { describe, expect, it } from 'vitest';
import { WorkspaceIds as W } from './workspaces';
import { isUploadCategoryAllowedInWorkspace } from './upload-workspace-policy';

describe('upload workspace category policy', () => {
  it('keeps Personal uploads limited to user content', () => {
    expect(isUploadCategoryAllowedInWorkspace(W.PERSONAL, 'document')).toBe(true);
    expect(isUploadCategoryAllowedInWorkspace(W.PERSONAL, 'avatar')).toBe(true);
    expect(isUploadCategoryAllowedInWorkspace(W.PERSONAL, 'receipt')).toBe(false);
    expect(isUploadCategoryAllowedInWorkspace(W.PERSONAL, 'trip-incident')).toBe(false);
  });

  it('prevents Tenant Admin from writing transport evidence namespaces', () => {
    for (const category of ['inspection', 'receipt', 'vehicle', 'trip-incident'] as const) {
      expect(isUploadCategoryAllowedInWorkspace(W.TENANT_ADMIN, category), category).toBe(false);
    }

    expect(isUploadCategoryAllowedInWorkspace(W.TENANT_ADMIN, 'document')).toBe(true);
    expect(isUploadCategoryAllowedInWorkspace(W.TENANT_ADMIN, 'avatar')).toBe(true);
    expect(isUploadCategoryAllowedInWorkspace(W.TENANT_ADMIN, 'import')).toBe(true);
    expect(isUploadCategoryAllowedInWorkspace(W.TENANT_ADMIN, 'signature')).toBe(true);
  });

  it('preserves Transport Admin operational uploads', () => {
    for (const category of ['inspection', 'receipt', 'vehicle', 'trip-incident', 'import'] as const) {
      expect(isUploadCategoryAllowedInWorkspace(W.TRANSPORT_ADMIN, category), category).toBe(true);
    }
  });
});
