import { describe, expect, it } from 'vitest';
import {
  getEligibleWorkspaces,
  resolveActiveWorkspace,
  SystemRoles as R,
  WorkspaceIds as W,
} from './workspaces';

describe('active workspace resolution', () => {
  it('always gives a tenant user a personal requester workspace', () => {
    expect(getEligibleWorkspaces([]).map(({ id }) => id)).toEqual([W.PERSONAL]);
  });

  it('keeps all eligible workspaces but activates only one', () => {
    const roles = [R.DRIVER, R.INSPECTOR];
    expect(getEligibleWorkspaces(roles).map(({ id }) => id)).toEqual([
      W.PERSONAL,
      W.DRIVER,
      W.INSPECTOR,
    ]);
    expect(resolveActiveWorkspace(roles, W.DRIVER)).toBe(W.DRIVER);
  });

  it('rejects stale workspace state after a role expires', () => {
    expect(resolveActiveWorkspace([R.INSPECTOR], W.DRIVER)).toBe(W.INSPECTOR);
  });

  it('isolates platform administrators from tenant workspaces', () => {
    expect(getEligibleWorkspaces([R.PLATFORM_ADMIN]).map(({ id }) => id)).toEqual([
      W.PLATFORM_ADMIN,
    ]);
  });
});
