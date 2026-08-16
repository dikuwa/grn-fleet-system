import { describe, expect, it } from 'vitest';
import { canUseGenericTenantFileKey } from './file-access-policy';
import { WorkspaceIds as W } from './workspaces';

describe('generic file access workspace policy', () => {
  it('allows tenant-wide operational and audit workspaces to resolve tenant file keys', () => {
    for (const workspace of [W.TRANSPORT_ADMIN, W.AUDIT]) {
      expect(canUseGenericTenantFileKey(workspace, 'trip-incidents/evidence.jpg')).toBe(true);
      expect(canUseGenericTenantFileKey(workspace, 'documents/request.pdf')).toBe(true);
    }
  });

  it('keeps Tenant Administration out of transport-operation evidence namespaces', () => {
    for (const key of [
      'inspections/photo.jpg',
      'receipts/fuel.jpg',
      'vehicles/roadworthy.pdf',
      'trip-incidents/evidence.jpg',
    ]) {
      expect(canUseGenericTenantFileKey(W.TENANT_ADMIN, key), key).toBe(false);
    }

    expect(canUseGenericTenantFileKey(W.TENANT_ADMIN, 'documents/staff-file.pdf')).toBe(true);
    expect(canUseGenericTenantFileKey(W.TENANT_ADMIN, 'imports/staff.csv')).toBe(true);
    expect(canUseGenericTenantFileKey(W.TENANT_ADMIN, 'driver-licences/driver/v2/front/licence.jpg')).toBe(true);
  });

  it('does not treat scoped workspaces as arbitrary tenant-file readers', () => {
    for (const workspace of [W.PERSONAL, W.APPROVER, W.DRIVER, W.INSPECTOR, W.MAINTENANCE]) {
      expect(canUseGenericTenantFileKey(workspace, 'documents/other-user.pdf'), workspace).toBe(false);
    }
  });
});
