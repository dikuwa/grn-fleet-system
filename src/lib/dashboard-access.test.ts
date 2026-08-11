import { describe, expect, it } from 'vitest';
import {
  canAccessDashboardPath,
  canPerformDashboardAction,
  getWorkspaceNavigation,
  resolveDashboardAccess,
  routeRegistry,
} from './dashboard-access';
import { SystemRoles as R, WorkspaceIds as W } from './workspaces';

describe('canonical workspace route policy', () => {
  it('has stable, unique route IDs and navigation destinations', () => {
    const ids = routeRegistry.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const workspace of Object.values(W)) {
      const hrefs = getWorkspaceNavigation(workspace).map((route) => route.href);
      expect(new Set(hrefs).size, workspace).toBe(hrefs.length);
    }
  });

  it.each([
    [R.REQUESTER, W.PERSONAL],
    [R.SUPERVISOR, W.APPROVER],
    [R.DRIVER, W.DRIVER],
    [R.INSPECTOR, W.INSPECTOR],
    [R.MAINTENANCE, W.MAINTENANCE],
    [R.TRANSPORT_ADMIN, W.TRANSPORT_ADMIN],
    [R.TENANT_ADMIN, W.TENANT_ADMIN],
    [R.AUDITOR, W.AUDIT],
  ])('keeps universal tenant self-service routes for %s', (role, workspace) => {
    for (const path of [
      '/dashboard',
      '/dashboard/profile',
      '/dashboard/requests/new',
      '/dashboard/requests',
      '/dashboard/notifications',
    ]) {
      expect(canAccessDashboardPath(path, [role], workspace), path).toBe(true);
    }
  });

  it('isolates platform administration from every tenant workspace', () => {
    expect(
      canAccessDashboardPath('/dashboard/platform', [R.PLATFORM_ADMIN], W.PLATFORM_ADMIN),
    ).toBe(true);
    expect(
      canAccessDashboardPath('/dashboard/requests', [R.PLATFORM_ADMIN], W.PLATFORM_ADMIN),
    ).toBe(false);
    expect(canAccessDashboardPath('/dashboard/platform', [R.TENANT_ADMIN], W.TENANT_ADMIN)).toBe(
      false,
    );
  });

  it('gives each platform system role a real, bounded workspace', () => {
    for (const path of [
      '/dashboard/platform',
      '/dashboard/platform/tenants',
      '/dashboard/platform/demo-requests',
      '/dashboard/platform/enquiries',
      '/dashboard/platform/emergency-contacts',
    ]) {
      expect(canAccessDashboardPath(path, [R.PLATFORM_SUPPORT], W.PLATFORM_ADMIN), path).toBe(true);
    }
    expect(
      canAccessDashboardPath('/dashboard/platform/users', [R.PLATFORM_SUPPORT], W.PLATFORM_ADMIN),
    ).toBe(false);
    expect(
      canAccessDashboardPath('/dashboard/platform/reset', [R.PLATFORM_SUPPORT], W.PLATFORM_ADMIN),
    ).toBe(false);

    for (const path of [
      '/dashboard/platform',
      '/dashboard/platform/tenants',
      '/dashboard/platform/audit',
    ]) {
      expect(canAccessDashboardPath(path, [R.PLATFORM_AUDITOR], W.PLATFORM_ADMIN), path).toBe(true);
    }
    expect(
      canAccessDashboardPath(
        '/dashboard/platform/demo-requests',
        [R.PLATFORM_AUDITOR],
        W.PLATFORM_ADMIN,
      ),
    ).toBe(false);
    expect(
      canAccessDashboardPath('/dashboard/platform/billing', [R.PLATFORM_AUDITOR], W.PLATFORM_ADMIN),
    ).toBe(false);

    for (const path of [
      '/dashboard/platform/users',
      '/dashboard/platform/onboard',
      '/dashboard/platform/subscriptions',
      '/dashboard/platform/packages',
      '/dashboard/platform/cms',
      '/dashboard/platform/reset',
      '/dashboard/platform/backups',
      '/dashboard/platform/billing',
    ]) {
      expect(canAccessDashboardPath(path, [R.PLATFORM_ADMIN], W.PLATFORM_ADMIN), path).toBe(true);
    }
  });

  it('does not union capabilities for a multi-role user', () => {
    const roles = [R.TENANT_ADMIN, R.TRANSPORT_ADMIN, R.DRIVER];
    expect(canAccessDashboardPath('/dashboard/allocations', roles, W.TENANT_ADMIN)).toBe(false);
    expect(canAccessDashboardPath('/dashboard/allocations', roles, W.TRANSPORT_ADMIN)).toBe(true);
    expect(canAccessDashboardPath('/dashboard/driver-mobile', roles, W.TRANSPORT_ADMIN)).toBe(
      false,
    );
    expect(canAccessDashboardPath('/dashboard/driver-mobile', roles, W.DRIVER)).toBe(true);
  });

  it('keeps tenant administration separate from transport operations', () => {
    const roles = [R.TENANT_ADMIN];
    for (const path of [
      '/dashboard/allocations',
      '/dashboard/trips',
      '/dashboard/fuel',
      '/dashboard/maintenance',
      '/dashboard/fleet/import',
    ]) {
      expect(canAccessDashboardPath(path, roles, W.TENANT_ADMIN), path).toBe(false);
    }
    expect(canPerformDashboardAction('/dashboard/staff', roles, 'update', W.TENANT_ADMIN)).toBe(
      true,
    );
  });

  it('separates tenant reset requests from platform reset execution', () => {
    expect(
      canAccessDashboardPath('/dashboard/admin/data-reset', [R.TENANT_ADMIN], W.TENANT_ADMIN),
    ).toBe(true);
    expect(
      canPerformDashboardAction(
        '/dashboard/admin/data-reset',
        [R.TENANT_ADMIN],
        'create',
        W.TENANT_ADMIN,
      ),
    ).toBe(true);
    expect(
      canAccessDashboardPath('/dashboard/platform/reset', [R.TENANT_ADMIN], W.TENANT_ADMIN),
    ).toBe(false);
    expect(
      canAccessDashboardPath('/dashboard/admin/data-reset', [R.PLATFORM_ADMIN], W.PLATFORM_ADMIN),
    ).toBe(false);
    expect(
      canAccessDashboardPath('/dashboard/platform/reset', [R.PLATFORM_ADMIN], W.PLATFORM_ADMIN),
    ).toBe(true);
  });

  it('applies assigned and related record scopes to operational workspaces', () => {
    expect(
      resolveDashboardAccess('/dashboard/approvals', [R.SUPERVISOR], W.APPROVER).recordScope,
    ).toBe('assigned');
    expect(resolveDashboardAccess('/dashboard/trips', [R.DRIVER], W.DRIVER).recordScope).toBe(
      'assigned',
    );
    expect(
      resolveDashboardAccess('/dashboard/inspections', [R.INSPECTOR], W.INSPECTOR).recordScope,
    ).toBe('assigned');
    expect(resolveDashboardAccess('/dashboard/fleet', [R.INSPECTOR], W.INSPECTOR).recordScope).toBe(
      'assigned',
    );
  });

  it('keeps audit tenant-wide and read-only', () => {
    for (const path of [
      '/dashboard/requests',
      '/dashboard/trips',
      '/dashboard/fleet',
      '/dashboard/fuel',
      '/dashboard/staff',
      '/dashboard/inspections',
      '/dashboard/maintenance',
      '/dashboard/documents',
      '/dashboard/reports',
      '/dashboard/audit',
    ]) {
      expect(canPerformDashboardAction(path, [R.AUDITOR], 'view', W.AUDIT), path).toBe(true);
      expect(canPerformDashboardAction(path, [R.AUDITOR], 'update', W.AUDIT), path).toBe(false);
      expect(canPerformDashboardAction(path, [R.AUDITOR], 'delete', W.AUDIT), path).toBe(false);
    }
  });

  it('evaluates specific child routes before broad route families', () => {
    expect(
      canAccessDashboardPath('/dashboard/notifications/history', [R.REQUESTER], W.PERSONAL),
    ).toBe(false);
    expect(canAccessDashboardPath('/dashboard/notifications', [R.REQUESTER], W.PERSONAL)).toBe(
      true,
    );
    expect(canAccessDashboardPath('/dashboard/fleet/import', [R.AUDITOR], W.AUDIT)).toBe(false);
    expect(canAccessDashboardPath('/dashboard/fleet', [R.AUDITOR], W.AUDIT)).toBe(true);
  });
});
