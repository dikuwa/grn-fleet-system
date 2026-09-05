import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/vehicles/[id]/availability/route.ts'),
  'utf8',
);

describe('vehicle availability UUID guard', () => {
  it('keeps auth, dashboard and date validation ahead of the vehicle id guard', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const dashboardIndex = source.indexOf("requireDashboardAction(session, '/dashboard/fleet', 'view')");
    const dateValidationIndex = source.indexOf('if (startParam && !isDateOnly(startParam))');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(dateValidationIndex).toBeGreaterThan(dashboardIndex);
    expect(guardIndex).toBeGreaterThan(dateValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('normalizes malformed ids to the existing vehicle-not-found availability response', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const vehicleLookupIndex = source.indexOf('.from(vehicles)', guardIndex);
    const guardBlock = source.slice(guardIndex, vehicleLookupIndex);

    expect(guardBlock).toContain('available: false');
    expect(guardBlock).toContain("detail: 'Vehicle not found'");
    expect(guardBlock).toContain("severity: 'error'");
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
