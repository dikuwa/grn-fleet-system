import { describe, expect, it } from 'vitest';
import { Permissions, RoleDefinitions } from '../permissions';
import { REGIONAL_WORKFLOW_STEPS } from '../workflow-engine';
import { SystemRoles, WorkspaceIds, getEligibleWorkspaces } from '../workspaces';

describe('Deputy Director regional authorisation contract', () => {
  it('grants regional final authorisation without national authorisation or release permissions', () => {
    const permissions = new Set(RoleDefinitions.DEPUTY_DIRECTOR.permissions);

    expect(RoleDefinitions.DEPUTY_DIRECTOR.name).toBe(SystemRoles.DEPUTY_DIRECTOR);
    expect(permissions.has(Permissions.TRIP_AUTHORIZE_REGIONAL)).toBe(true);
    expect(permissions.has(Permissions.TRIP_AUTHORIZE_NATIONAL)).toBe(false);
    expect(permissions.has(Permissions.VEHICLE_RELEASE_REGIONAL)).toBe(false);
    expect(permissions.has(Permissions.VEHICLE_RELEASE_NATIONAL)).toBe(false);
  });

  it('surfaces the Deputy Director in the Approvals workspace', () => {
    const workspaceIds = getEligibleWorkspaces([SystemRoles.DEPUTY_DIRECTOR]).map(
      (workspace) => workspace.id,
    );

    expect(workspaceIds).toContain(WorkspaceIds.APPROVER);
  });

  it('keeps regional final authorisation after release and immediately before driver acknowledgement', () => {
    const release = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'release');
    const authorise = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'authorise');
    const acknowledge = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'acknowledge');

    expect(authorise?.requiredPermission).toBe(Permissions.TRIP_AUTHORIZE_REGIONAL);
    expect(authorise?.stepOrder).toBe((release?.stepOrder ?? 0) + 1);
    expect(acknowledge?.stepOrder).toBe((authorise?.stepOrder ?? 0) + 1);
  });

  it('does not allow the regional authoriser role to inherit driver acknowledgement permission', () => {
    expect(RoleDefinitions.DEPUTY_DIRECTOR.permissions).not.toContain(Permissions.DRIVER_LOG_CREATE);
  });
});
