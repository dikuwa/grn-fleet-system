import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const internalReturn = read('src/app/api/trips/[id]/return/route.ts');
const externalStart = read('src/app/api/trips/[id]/external-start/route.ts');
const externalReturn = read('src/app/api/trips/[id]/external-return/route.ts');

describe('trip return/start UUID guards', () => {
  it('preserves internal return body/auth/permission precedence before the trip guard', () => {
    const bodyIndex = internalReturn.indexOf('!Number.isInteger(body.endingOdometer)');
    const lengthIndex = internalReturn.indexOf('if (body.returnLocation.trim().length > 240');
    const authIndex = internalReturn.indexOf('const auth = await requireRequestAuth(req)');
    const routeIndex = internalReturn.indexOf("requireDashboardAction(session, '/dashboard/trips', 'update')");
    const permissionIndex = internalReturn.indexOf('const permCheck = await requireAnyPermission');
    const guardIndex = internalReturn.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = internalReturn.indexOf('const db = getDb()');

    expect(internalReturn).toContain('const UUID_PATTERN =');
    expect(lengthIndex).toBeGreaterThan(bodyIndex);
    expect(authIndex).toBeGreaterThan(lengthIndex);
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(internalReturn).toContain("{ error: 'Trip not found' }, { status: 404 }");
    expect(internalReturn).toContain('atomic_trip_return_failed_');
  });

  it('preserves external start auth/permission and body validation before the trip guard', () => {
    const authIndex = externalStart.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = externalStart.indexOf("requireDashboardAction(session, '/dashboard/trips', 'update')");
    const permissionIndex = externalStart.indexOf('const permissionCheck = await requirePermission(session, Permissions.TRIP_MANAGE)');
    const bodyIndex = externalStart.indexOf('!Number.isInteger(body.beginningOdometer)');
    const latitudeIndex = externalStart.indexOf("return NextResponse.json({ error: 'Latitude is invalid' }");
    const longitudeIndex = externalStart.indexOf("return NextResponse.json({ error: 'Longitude is invalid' }");
    const guardIndex = externalStart.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = externalStart.indexOf('const db = getDb()');

    expect(externalStart).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(bodyIndex).toBeGreaterThan(permissionIndex);
    expect(latitudeIndex).toBeGreaterThan(bodyIndex);
    expect(longitudeIndex).toBeGreaterThan(latitudeIndex);
    expect(guardIndex).toBeGreaterThan(longitudeIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(externalStart).toContain('External-driver trip is not ready for departure or has not been physically issued');
    expect(externalStart).toContain('atomic_external_trip_start_failed_');
  });

  it('preserves external return auth/permission and payload validation before the trip guard', () => {
    const authIndex = externalReturn.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = externalReturn.indexOf("requireDashboardAction(session, '/dashboard/trips', 'update')");
    const permissionIndex = externalReturn.indexOf('const permissionCheck = await requirePermission(session, Permissions.TRIP_MANAGE)');
    const bodyIndex = externalReturn.indexOf('!Number.isInteger(body.endingOdometer)');
    const lengthIndex = externalReturn.indexOf('if (body.returnLocation.trim().length > 240');
    const guardIndex = externalReturn.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = externalReturn.indexOf('const db = getDb()');

    expect(externalReturn).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(bodyIndex).toBeGreaterThan(permissionIndex);
    expect(lengthIndex).toBeGreaterThan(bodyIndex);
    expect(guardIndex).toBeGreaterThan(lengthIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(externalReturn).toContain("{ error: 'Active external-driver trip not found' }, { status: 404 }");
    expect(externalReturn).toContain('atomic_external_trip_return_failed_');
  });
});
