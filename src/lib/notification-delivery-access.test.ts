import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAccessDashboardPath } from './dashboard-access';
import { SystemRoles as R, WorkspaceIds as W } from './workspaces';

const deliveryDashboardPath = '/dashboard/notifications/deliveries';

describe('notification delivery workspace boundary', () => {
  it('keeps the operational delivery dashboard out of the Audit workspace', () => {
    expect(canAccessDashboardPath(deliveryDashboardPath, [R.AUDITOR], W.AUDIT)).toBe(false);
    expect(
      canAccessDashboardPath(deliveryDashboardPath, [R.TRANSPORT_ADMIN], W.TRANSPORT_ADMIN),
    ).toBe(true);
    expect(canAccessDashboardPath(deliveryDashboardPath, [R.TENANT_ADMIN], W.TENANT_ADMIN)).toBe(
      true,
    );
  });

  it('requires the active delivery-dashboard workspace before API reads or retries', () => {
    const listSource = readFileSync(
      'src/app/api/notifications/deliveries/route.ts',
      'utf8',
    );
    const retrySource = readFileSync(
      'src/app/api/notifications/deliveries/[id]/retry/route.ts',
      'utf8',
    );

    for (const source of [listSource, retrySource]) {
      expect(source).toContain('requireDashboardAction');
      expect(source).toContain("'/dashboard/notifications/deliveries'");
    }

    expect(listSource).not.toContain('Permissions.AUDIT_READ');
    expect(retrySource).toContain('Permissions.TENANT_MANAGE');
    expect(retrySource).toContain('Permissions.DRIVER_MANAGE');
  });
});
