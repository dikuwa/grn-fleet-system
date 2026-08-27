import { describe, expect, it } from 'vitest';

import {
  getAllPermissionCodes,
  isPermissionAvailableInWorkspace,
  PermissionGroups,
  Permissions,
  RoleDefinitions,
} from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';

describe('retired emergency workflow override', () => {
  it('keeps the legacy code only for historical decoding', () => {
    expect(Permissions.TRIP_AUTHORIZE_EMERGENCY).toBe('trip:authorize-emergency');
    expect(getAllPermissionCodes()).not.toContain(Permissions.TRIP_AUTHORIZE_EMERGENCY);
  });

  it('cannot be used from any active workspace', () => {
    for (const workspace of Object.values(WorkspaceIds)) {
      expect(
        isPermissionAvailableInWorkspace(Permissions.TRIP_AUTHORIZE_EMERGENCY, workspace),
      ).toBe(false);
    }
  });

  it('is not granted to the Chief Regional Officer', () => {
    expect(RoleDefinitions.CHIEF_REGIONAL_OFFICER.permissions).not.toContain(
      Permissions.TRIP_AUTHORIZE_EMERGENCY,
    );
  });

  it('is not exposed in active permission-management groups', () => {
    for (const group of Object.values(PermissionGroups)) {
      expect(group.permissions).not.toContain(Permissions.TRIP_AUTHORIZE_EMERGENCY);
    }
  });
});
