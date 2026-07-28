import { describe, expect, it } from 'vitest';
import {
  canAccessDashboardPath,
  canNavigateDashboardPath,
  canPerformDashboardAction,
  resolveDashboardAccess,
  SystemRoles,
} from './dashboard-access';

const R = SystemRoles;

describe('central dashboard route policy', () => {
  it.each(Object.values(R))('keeps common authenticated routes for %s', (role) => {
    expect(canAccessDashboardPath('/dashboard', [role])).toBe(true);
    expect(canAccessDashboardPath('/dashboard/profile', [role])).toBe(true);
    expect(canAccessDashboardPath('/dashboard/notifications', [role])).toBe(true);
  });

  it('isolates platform administration from tenant operations', () => {
    const roles = [R.PLATFORM_ADMIN];
    expect(canNavigateDashboardPath('/dashboard/platform', roles)).toBe(true);
    expect(canAccessDashboardPath('/dashboard/platform/audit', roles)).toBe(true);
    expect(canAccessDashboardPath('/dashboard/requests', roles)).toBe(false);
    expect(canAccessDashboardPath('/dashboard/fleet', roles)).toBe(false);
  });

  it('gives Tenant Administrators oversight without transport actions', () => {
    const roles = [R.TENANT_ADMIN];
    expect(resolveDashboardAccess('/dashboard/requests', roles).recordScope).toBe('tenant');
    expect(canPerformDashboardAction('/dashboard/requests', roles, 'view')).toBe(true);
    expect(canPerformDashboardAction('/dashboard/requests', roles, 'update')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/allocations', roles, 'create')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/trips', roles, 'update')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/trips/active', roles, 'view')).toBe(true);
    expect(canPerformDashboardAction('/dashboard/trips/closure-review', roles, 'view')).toBe(true);
    expect(canPerformDashboardAction('/dashboard/trips/closure-review', roles, 'approve')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/fuel', roles, 'update')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/maintenance', roles, 'create')).toBe(false);
    expect(canPerformDashboardAction('/dashboard/fleet/import', roles, 'import')).toBe(true);
  });

  it('limits requesters, approvers, drivers and inspectors to their record scopes', () => {
    expect(resolveDashboardAccess('/dashboard/requests', [R.REQUESTER]).recordScope).toBe('self');
    expect(resolveDashboardAccess('/dashboard/approvals', [R.SUPERVISOR]).recordScope).toBe('assigned');
    expect(resolveDashboardAccess('/dashboard/trips', [R.DRIVER]).recordScope).toBe('assigned');
    expect(resolveDashboardAccess('/dashboard/inspections', [R.INSPECTOR]).recordScope).toBe('assigned');
    expect(canAccessDashboardPath('/dashboard/fleet', [R.REQUESTER])).toBe(false);
    expect(canAccessDashboardPath('/dashboard/requests', [R.DRIVER])).toBe(false);
  });

  it('keeps auditors tenant-wide and read-only', () => {
    const roles = [R.AUDITOR];
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
      '/dashboard/notifications/history',
    ]) {
      expect(canPerformDashboardAction(path, roles, 'view'), path).toBe(true);
      expect(canPerformDashboardAction(path, roles, 'create'), path).toBe(false);
      expect(canPerformDashboardAction(path, roles, 'update'), path).toBe(false);
      expect(canPerformDashboardAction(path, roles, 'delete'), path).toBe(false);
      expect(canPerformDashboardAction(path, roles, 'import'), path).toBe(false);
    }
  });

  it('combines active multi-role grants without weakening the strongest scope', () => {
    const roles = [R.TENANT_ADMIN, R.TRANSPORT_ADMIN];
    const access = resolveDashboardAccess('/dashboard/trips', roles);
    expect(access.accessMode).toBe('tenant_manage');
    expect(access.recordScope).toBe('tenant');
    expect(access.actions).toContain('update');
  });

  it('evaluates specific child routes before broad route families', () => {
    expect(canAccessDashboardPath('/dashboard/notifications/history', [R.REQUESTER])).toBe(false);
    expect(canAccessDashboardPath('/dashboard/notifications', [R.REQUESTER])).toBe(true);
    expect(canAccessDashboardPath('/dashboard/fleet/import', [R.AUDITOR])).toBe(false);
    expect(canAccessDashboardPath('/dashboard/fleet', [R.AUDITOR])).toBe(true);
  });
});
