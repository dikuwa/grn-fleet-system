import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const candidates = read(
  'src/app/api/allocations/[id]/replacement-candidates/route.ts',
);
const replace = read('src/app/api/allocations/[id]/replace/route.ts');

describe('allocation UUID guards', () => {
  it('keeps replacement-candidate authorization before the allocation guard and DB access after it', () => {
    const authIndex = candidates.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = candidates.indexOf(
      "requireDashboardAction(auth.session, '/dashboard/allocations', 'update')",
    );
    const permissionIndex = candidates.indexOf(
      'const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE)',
    );
    const guardIndex = candidates.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = candidates.indexOf('const db = getDb()');

    expect(candidates).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(candidates).toContain("{ error: 'Allocation not found' }, { status: 404 }");
    expect(candidates).toContain("authoritativeEligibility: 'replacement_service'");
  });

  it('guards route and replacement-vehicle UUIDs before invoking the canonical replacement service', () => {
    const authIndex = replace.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = replace.indexOf(
      "requireDashboardAction(auth.session, '/dashboard/allocations', 'update')",
    );
    const permissionIndex = replace.indexOf(
      'const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE)',
    );
    const bodyIndex = replace.indexOf('const body = await request.json()');
    const allocationGuardIndex = replace.indexOf('if (!UUID_PATTERN.test(id))');
    const vehicleGuardIndex = replace.indexOf("typeof replacementVehicleId !== 'string'");
    const serviceIndex = replace.indexOf('const result = await replaceVehicle(');

    expect(replace).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(bodyIndex).toBeGreaterThan(permissionIndex);
    expect(allocationGuardIndex).toBeGreaterThan(bodyIndex);
    expect(vehicleGuardIndex).toBeGreaterThan(allocationGuardIndex);
    expect(serviceIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(replace).toContain("{ error: 'Allocation not found' }, { status: 404 }");
    expect(replace).toContain("{ error: 'Replacement vehicle not found in this tenant' }");
  });

  it('preserves the canonical replacement and overlap-conflict behavior', () => {
    expect(replace).toContain('replaceVehicle, VehicleReplaceError');
    expect(replace).toContain("code === '23P01'");
    expect(replace).toContain("message.includes('allocation_vehicle_overlap')");
    expect(replace).toContain('replacement_departure_inspection_required');
  });
});
