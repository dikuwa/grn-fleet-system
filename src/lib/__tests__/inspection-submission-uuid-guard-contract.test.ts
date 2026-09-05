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
    const guardIndex = source.indexOf('!UUID_PATTERN.test(vehicleId) || !UUID_PATTERN.test(tripId)');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(dashboardIndex);
    expect(checklistIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(checklistIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('maps malformed supplied vehicle or trip ids to a controlled not-found response', () => {
    const guardIndex = source.indexOf('!UUID_PATTERN.test(vehicleId) || !UUID_PATTERN.test(tripId)');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain("{ error: 'Trip or vehicle not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
