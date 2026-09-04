import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/create-from-allocation/route.ts'),
  'utf8',
);

describe('trip creation allocation UUID guard', () => {
  it('keeps required-field and authorization checks before the allocation UUID guard', () => {
    const requiredIndex = route.indexOf("if (!allocationId)");
    const authIndex = route.indexOf('const auth = await requireRequestAuth(req)');
    const routeIndex = route.indexOf("requireDashboardAction(session, '/dashboard/allocations', 'create')");
    const permissionIndex = route.indexOf(
      'const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(allocationId))');
    const dbIndex = route.indexOf('const db = getDb()');

    expect(route).toContain('const UUID_PATTERN =');
    expect(authIndex).toBeGreaterThan(requiredIndex);
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Allocation not found' }, { status: 404 }");
  });

  it('preserves replay and atomic creation conflict handling', () => {
    expect(route).toContain('const replayExistingTrip = async () =>');
    expect(route).toContain('TRIP_CREATION_ALLOCATION_CONFLICT');
    expect(route).toContain("details.code === '23505'");
    expect(route).toContain('alreadyExists: true');
    expect(route).toContain('runAtomicMutations');
  });
});
