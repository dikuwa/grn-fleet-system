import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection submission UUID guard', () => {
  it('keeps auth, dashboard, permission and checklist validation ahead of malformed id rejection', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const dashboardIndex = source.indexOf("'/dashboard/inspections/new'");
    const permissionIndex = source.indexOf('requirePermission(session, Permissions.INSPECTION_PERFORM)');
    const checklistIndex = source.indexOf('if (checklist.length > 0 && assessedItems.length === 0)');
    const vehicleGuardIndex = source.indexOf('(vehicleId && !UUID_PATTERN.test(vehicleId))');
    const tripGuardIndex = source.indexOf('(tripId && !UUID_PATTERN.test(tripId))');
    const dbIndex = source.indexOf('const db = getDb();', vehicleGuardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(dashboardIndex);
    expect(checklistIndex).toBeGreaterThan(permissionIndex);
    expect(vehicleGuardIndex).toBeGreaterThan(checklistIndex);
    expect(tripGuardIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(dbIndex).toBeGreaterThan(tripGuardIndex);
  });

  it('maps each malformed supplied vehicle or trip id independently to a controlled not-found response', () => {
    const guardIndex = source.indexOf('(vehicleId && !UUID_PATTERN.test(vehicleId))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain('(tripId && !UUID_PATTERN.test(tripId))');
    expect(guardBlock).toContain("{ error: 'Trip or vehicle not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
    expect(guardBlock).not.toContain('vehicleId &&\n      tripId &&');
  });
});
