import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/[id]/driver/route.ts'),
  'utf8',
);
const patch = source.slice(
  source.indexOf('export async function PATCH'),
  source.indexOf('export async function DELETE'),
);
const remove = source.slice(source.indexOf('export async function DELETE'));

describe('allocation driver UUID guards', () => {
  it('keeps PATCH authorization and required-driver validation before UUID guards and DB access', () => {
    const authIndex = patch.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = patch.indexOf(
      "requireDashboardAction(session, '/dashboard/allocations', 'update')",
    );
    const permissionIndex = patch.indexOf(
      'const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const requiredIndex = patch.indexOf('if (!driverEmployeeId)');
    const allocationGuardIndex = patch.indexOf('if (!UUID_PATTERN.test(id))');
    const driverGuardIndex = patch.indexOf("typeof driverEmployeeId !== 'string'");
    const dbIndex = patch.indexOf('const db = getDb()');

    expect(source).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(requiredIndex).toBeGreaterThan(permissionIndex);
    expect(allocationGuardIndex).toBeGreaterThan(requiredIndex);
    expect(driverGuardIndex).toBeGreaterThan(allocationGuardIndex);
    expect(dbIndex).toBeGreaterThan(driverGuardIndex);
    expect(patch).toContain("{ error: 'Allocation not found' }, { status: 404 }");
    expect(patch).toContain("{ error: 'Driver has no active licence profile.' }, { status: 409 }");
  });

  it('preserves governed replacement, compliance, overlap and atomic reassignment behavior', () => {
    expect(patch).toContain('requestPostAuthorisationDriverReplacement({');
    expect(patch).toContain('calculateDriverCompliance({');
    expect(patch).toContain('Driver is already assigned during this period');
    expect(patch).toContain('atomic_driver_reassignment_failed');
    expect(patch).toContain("mutationErrorCode === '23P01'");
    expect(patch).toContain("mutationErrorText.includes('allocation_driver_overlap')");
    expect(patch).toContain("eventType: allocation.driverEmployeeId ? 'driver.reassigned' : 'driver.assigned'");
  });

  it('keeps DELETE reason validation before the allocation guard and DB access', () => {
    const authIndex = remove.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = remove.indexOf(
      'const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const reasonIndex = remove.indexOf('if (!cleanReason)');
    const lengthIndex = remove.indexOf('if (cleanReason.length > 500)');
    const guardIndex = remove.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = remove.indexOf('const db = getDb()');

    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(reasonIndex).toBeGreaterThan(permissionIndex);
    expect(lengthIndex).toBeGreaterThan(reasonIndex);
    expect(guardIndex).toBeGreaterThan(lengthIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(remove).toContain("{ error: 'Allocation not found' }, { status: 404 }");
    expect(remove).toContain('atomic_driver_unassignment_failed');
    expect(remove).toContain('This driver is recorded on an issued Trip Authority');
  });
});
