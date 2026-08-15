import { describe, expect, it } from 'vitest';
import { Permissions, RoleDefinitions } from '../permissions';
import { REGIONAL_WORKFLOW_STEPS, NATIONAL_WORKFLOW_STEPS } from '../workflow-engine';
import { getEligibleWorkspaces, SystemRoles, WorkspaceIds } from '../workspaces';

describe('Control Administrative Officer workflow contract', () => {
  it('keeps regional release and official inspection permissions in the protected system baseline', () => {
    const permissions = new Set(RoleDefinitions.CONTROL_ADMIN_OFFICER.permissions);

    expect(RoleDefinitions.CONTROL_ADMIN_OFFICER.name).toBe(SystemRoles.RELEASE_OFFICER);
    expect(permissions.has(Permissions.VEHICLE_RELEASE_REGIONAL)).toBe(true);
    expect(permissions.has(Permissions.INSPECTION_PERFORM)).toBe(true);
    expect(permissions.has(Permissions.INSPECTION_VIEW)).toBe(true);
    expect(permissions.has(Permissions.TRIP_VIEW)).toBe(true);
    expect(permissions.has(Permissions.VEHICLE_VIEW)).toBe(true);
    expect(permissions.has(Permissions.FILE_VIEW)).toBe(true);
    expect(permissions.has(Permissions.FILE_UPLOAD)).toBe(true);
  });

  it('exposes separate Approvals and Inspections workspaces for the same role', () => {
    const workspaces = getEligibleWorkspaces([SystemRoles.RELEASE_OFFICER]);
    const workspaceIds = workspaces.map((workspace) => workspace.id);

    expect(workspaceIds).toContain(WorkspaceIds.APPROVER);
    expect(workspaceIds).toContain(WorkspaceIds.INSPECTOR);
  });

  it('keeps administrative release before final authorisation and driver acknowledgement', () => {
    const release = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'release');
    const authorise = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'authorise');
    const acknowledge = REGIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'acknowledge');

    expect(release?.requiredPermission).toBe(Permissions.VEHICLE_RELEASE_REGIONAL);
    expect(release?.stepOrder).toBeLessThan(authorise?.stepOrder ?? Number.POSITIVE_INFINITY);
    expect(authorise?.stepOrder).toBeLessThan(acknowledge?.stepOrder ?? Number.POSITIVE_INFINITY);
  });

  it('keeps national release assigned to the national release permission, not the regional officer baseline', () => {
    const nationalRelease = NATIONAL_WORKFLOW_STEPS.find((step) => step.actionType === 'release');

    expect(nationalRelease?.requiredPermission).toBe(Permissions.VEHICLE_RELEASE_NATIONAL);
    expect(RoleDefinitions.CONTROL_ADMIN_OFFICER.permissions).not.toContain(
      Permissions.VEHICLE_RELEASE_NATIONAL,
    );
  });
});
