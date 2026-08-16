import { describe, expect, it } from 'vitest';
import {
  SystemRoles,
  canAccessDashboardPath,
  canPerformDashboardAction,
  getWorkspaceNavigation,
} from '@/lib/dashboard-access';
import { WorkspaceIds } from '@/lib/workspaces';

describe('Auditor dashboard access boundary', () => {
  const roles = [SystemRoles.AUDITOR];

  it('keeps the transport-request register readable but request creation unavailable', () => {
    expect(canAccessDashboardPath('/dashboard/requests', roles, WorkspaceIds.AUDIT)).toBe(true);
    expect(canAccessDashboardPath('/dashboard/requests/new', roles, WorkspaceIds.AUDIT)).toBe(false);
    expect(
      canPerformDashboardAction(
        '/dashboard/requests/new',
        roles,
        'create',
        WorkspaceIds.AUDIT,
      ),
    ).toBe(false);
  });

  it('does not advertise New Transport Request in Auditor navigation', () => {
    const hrefs = getWorkspaceNavigation(WorkspaceIds.AUDIT, roles).map((item) => item.href);
    expect(hrefs).not.toContain('/dashboard/requests/new');
    expect(hrefs).toContain('/dashboard/requests');
  });
});
