import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const action = read('src/app/api/allocations/[id]/action/route.ts');
const externalDetail = read('src/app/api/allocations/external/[id]/route.ts');
const externalDecision = read('src/app/api/allocations/external/[id]/decision/route.ts');

describe('allocation action and external assignment UUID guards', () => {
  it('keeps action-type validation before allocation and replacement-vehicle guards', () => {
    const authIndex = action.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = action.indexOf(
      'const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const actionValidationIndex = action.indexOf("!['confirm', 'cancel', 'replace_vehicle'].includes(actionType)");
    const allocationGuardIndex = action.indexOf('if (!UUID_PATTERN.test(id))');
    const replacementGuardIndex = action.indexOf("actionType === 'replace_vehicle' &&");
    const replacementServiceIndex = action.indexOf('const result = await replaceVehicle({');
    const dbIndex = action.indexOf('const db = getDb()');

    expect(action).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(actionValidationIndex).toBeGreaterThan(permissionIndex);
    expect(allocationGuardIndex).toBeGreaterThan(actionValidationIndex);
    expect(replacementGuardIndex).toBeGreaterThan(allocationGuardIndex);
    expect(replacementServiceIndex).toBeGreaterThan(replacementGuardIndex);
    expect(dbIndex).toBeGreaterThan(allocationGuardIndex);
    expect(action).toContain("{ error: 'Allocation not found' }, { status: 404 }");
    expect(action).toContain('atomic_allocation_confirm_failed');
    expect(action).toContain('atomic_allocation_cancel_failed');
  });

  it('keeps external assignment detail authorization ahead of the privacy guard', () => {
    const authIndex = externalDetail.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = externalDetail.indexOf(
      "requireDashboardAction(session, '/dashboard/allocations', 'view')",
    );
    const permissionIndex = externalDetail.indexOf(
      'const permissionCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const paramsIndex = externalDetail.indexOf('const { id } = await context.params');
    const guardIndex = externalDetail.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = externalDetail.indexOf('const db = getDb()');

    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(paramsIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(paramsIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(externalDetail).toContain("{ error: 'External driver assignment not found' }, { status: 404 }");
  });

  it('keeps external decision action validation before the assignment UUID guard and atomic claims', () => {
    const authIndex = externalDecision.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = externalDecision.indexOf(
      'const permissionCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const actionIndex = externalDecision.indexOf("if (action !== 'accept' && action !== 'cancel')");
    const guardIndex = externalDecision.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = externalDecision.indexOf('const db = getDb()');

    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(actionIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(actionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(externalDecision).toContain("{ error: 'External driver assignment not found' }, { status: 404 }");
    expect(externalDecision).toContain('allocationVersion: vehicleAllocations.version');
    expect(externalDecision).toContain("state = 'pending_acceptance'");
    expect(externalDecision).toContain('allocation_claim AS (');
    expect(externalDecision).toContain('assignment_claim AS (');
  });
});
