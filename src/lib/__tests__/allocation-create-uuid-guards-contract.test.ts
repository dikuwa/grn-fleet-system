import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/route.ts'),
  'utf8',
);

describe('allocation creation UUID guards', () => {
  it('guards a direct request ID after authorization/body parsing and before database access', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(req)');
    const routeIndex = source.indexOf(
      "requireDashboardAction(session, '/dashboard/allocations', 'create')",
    );
    const permissionIndex = source.indexOf(
      'const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE)',
    );
    const bodyIndex = source.indexOf('const body: any = await req.json()');
    const requestGuardIndex = source.indexOf(
      "requestId && (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId))",
    );
    const dbIndex = source.indexOf('const db = getDb()');

    expect(source).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(bodyIndex).toBeGreaterThan(permissionIndex);
    expect(requestGuardIndex).toBeGreaterThan(bodyIndex);
    expect(dbIndex).toBeGreaterThan(requestGuardIndex);
    expect(source).toContain("{ error: 'Transport request not found' }, { status: 404 }");
    expect(source).toContain('if (!resolvedRequestId && requestReference)');
  });

  it('keeps recommend-only and required start-date validation ahead of the vehicle UUID guard', () => {
    const recommendIndex = source.indexOf('if (recommendOnly)');
    const recommendReturnIndex = source.indexOf('return NextResponse.json({ recommendation });');
    const vehicleRequiredIndex = source.indexOf('if (!resolvedVehicleId)');
    const startRequiredIndex = source.indexOf('if (!startDate)');
    const vehicleGuardIndex = source.indexOf(
      "typeof resolvedVehicleId !== 'string' || !UUID_PATTERN.test(resolvedVehicleId)",
    );
    const vehicleSelectIndex = source.indexOf('const [vehicle] = await db');

    expect(recommendReturnIndex).toBeGreaterThan(recommendIndex);
    expect(vehicleRequiredIndex).toBeGreaterThan(recommendReturnIndex);
    expect(startRequiredIndex).toBeGreaterThan(vehicleRequiredIndex);
    expect(vehicleGuardIndex).toBeGreaterThan(startRequiredIndex);
    expect(vehicleSelectIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(source).toContain("{ error: 'Vehicle not found' }, { status: 404 }");
    expect(source).toContain('if (!resolvedVehicleId && vehicleGrn)');
  });

  it('keeps nomination override validation ahead of driver UUID validation and driver-profile access', () => {
    const resolvedDriverIndex = source.indexOf(
      'const resolvedDriverId: string | null = driverEmployeeId || null',
    );
    const overrideIndex = source.indexOf(
      'if (driverNominationOverridden && driverOverrideReason.length < 3)',
    );
    const driverGuardIndex = source.indexOf(
      "typeof resolvedDriverId !== 'string' || !UUID_PATTERN.test(resolvedDriverId)",
    );
    const complianceIndex = source.indexOf(
      'let driverCompliance: ReturnType<typeof calculateDriverCompliance> | null = null',
    );
    const driverSelectIndex = source.indexOf('const [driver] = await db');

    expect(overrideIndex).toBeGreaterThan(resolvedDriverIndex);
    expect(driverGuardIndex).toBeGreaterThan(overrideIndex);
    expect(complianceIndex).toBeGreaterThan(driverGuardIndex);
    expect(driverSelectIndex).toBeGreaterThan(complianceIndex);
    expect(source).toContain("{ error: 'Driver has no active licence profile.' }, { status: 409 }");
  });

  it('preserves allocation safety, compliance, atomic creation and DB error normalization', () => {
    expect(source).toContain('Vehicle is already allocated during this period');
    expect(source).toContain('calculateDriverCompliance({');
    expect(source).toContain('runAtomicMutations((tx) => {');
    expect(source).toContain('allocation_request_already_live');
    expect(source).toContain('allocation_vehicle_overlap');
    expect(source).toContain('allocation_driver_overlap');
    expect(source).toContain("candidate?.code === '23P01'");
    expect(source).toContain("candidate?.code === '23514'");
    expect(source).toContain("candidate?.code === '23503'");
  });
});
