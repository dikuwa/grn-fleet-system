import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/driver-handover/route.ts'),
  'utf8',
);

describe('driver handover UUID guards', () => {
  it('keeps initiate validation and permissions before guarding trip and relief-driver IDs', () => {
    const postIndex = route.indexOf('export async function POST');
    const actionIndex = route.indexOf("if (body.action !== 'initiate')", postIndex);
    const routeCheckIndex = route.indexOf("requireDashboardAction(session, '/dashboard/trips', 'update')", postIndex);
    const permissionIndex = route.indexOf('const permissionCheck = await requireAnyPermission', postIndex);
    const reliefIndex = route.indexOf("if (!newDriverEmployeeId) return NextResponse.json({ error: 'Select the relief driver' }", postIndex);
    const reasonIndex = route.indexOf('if (reason.length < 10 || reason.length > 500)', postIndex);
    const odometerIndex = route.indexOf('if (!Number.isInteger(handoverOdometer) || handoverOdometer < 0)', postIndex);
    const tripGuardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))', postIndex);
    const driverGuardIndex = route.indexOf('if (!UUID_PATTERN.test(newDriverEmployeeId))', postIndex);
    const dbIndex = route.indexOf('const db = getDb()', postIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(actionIndex).toBeGreaterThan(postIndex);
    expect(routeCheckIndex).toBeGreaterThan(actionIndex);
    expect(permissionIndex).toBeGreaterThan(routeCheckIndex);
    expect(reliefIndex).toBeGreaterThan(permissionIndex);
    expect(reasonIndex).toBeGreaterThan(reliefIndex);
    expect(odometerIndex).toBeGreaterThan(reasonIndex);
    expect(tripGuardIndex).toBeGreaterThan(odometerIndex);
    expect(driverGuardIndex).toBeGreaterThan(tripGuardIndex);
    expect(dbIndex).toBeGreaterThan(driverGuardIndex);
    expect(route).toContain("{ error: 'Trip not found' }, { status: 404 }");
    expect(route).toContain('The selected relief driver is not active, authorised, or does not have an active verified licence');
  });

  it('keeps acknowledge driver permissions before the trip guard and all DB access after it', () => {
    const acknowledgeIndex = route.indexOf('async function acknowledgeHandover');
    const routeCheckIndex = route.indexOf("requireDashboardAction(session, '/dashboard/driver-mobile', 'update')", acknowledgeIndex);
    const permissionIndex = route.indexOf('const canDrive = await hasPermission(session, Permissions.DRIVER_LOG_CREATE)', acknowledgeIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))', acknowledgeIndex);
    const dbIndex = route.indexOf('const db = getDb()', acknowledgeIndex);

    expect(routeCheckIndex).toBeGreaterThan(acknowledgeIndex);
    expect(permissionIndex).toBeGreaterThan(routeCheckIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Pending handover assignment not found' }, { status: 404 }");
  });

  it('preserves both atomic handover conflict families', () => {
    expect(route).toContain('atomic_driver_handover_initiate_failed');
    expect(route).toContain('atomic_driver_handover_ack_failed');
    expect(route).toContain('{ status: 409 }');
  });
});