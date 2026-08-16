import { describe, expect, it } from 'vitest';
import { isPermissionAvailableInWorkspace, Permissions } from './permissions';
import { WorkspaceIds as W } from './workspaces';

describe('workspace permission boundaries', () => {
  it('keeps incident operations out of the Tenant Administrator workspace', () => {
    for (const permission of [
      Permissions.TRIP_INCIDENT_MANAGE,
      Permissions.INCIDENT_COMPLETE_DETAILS,
      Permissions.INCIDENT_INVESTIGATE,
      Permissions.INCIDENT_CLOSE_INVESTIGATION,
      Permissions.INCIDENT_TECHNICAL_CLEARANCE,
      Permissions.INCIDENT_INSURANCE_UPDATE,
    ]) {
      expect(isPermissionAvailableInWorkspace(permission, W.TENANT_ADMIN), permission).toBe(false);
      expect(isPermissionAvailableInWorkspace(permission, W.TRANSPORT_ADMIN), permission).toBe(true);
    }
  });

  it('preserves Tenant Administrator governance capabilities', () => {
    for (const permission of [
      Permissions.TENANT_MANAGE,
      Permissions.STAFF_MANAGE,
      Permissions.USER_INVITE,
      Permissions.AUDIT_READ,
      Permissions.REPORT_VIEW,
      Permissions.EMERGENCY_CONTACTS_MANAGE,
    ]) {
      expect(isPermissionAvailableInWorkspace(permission, W.TENANT_ADMIN), permission).toBe(true);
    }
  });
});
