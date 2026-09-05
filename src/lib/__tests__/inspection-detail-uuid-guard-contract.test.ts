import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/[id]/route.ts'),
  'utf8',
);

describe('inspection detail UUID guard', () => {
  it('keeps authorization and scope resolution ahead of the id guard', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(req)');
    const dashboardIndex = source.indexOf("requireDashboardAction(session, '/dashboard/inspections', 'view')");
    const scopeIndex = source.indexOf("resolveDashboardAccess('/dashboard/inspections', roleNames)");
    const permissionIndex = source.indexOf('requirePermission(session, Permissions.INSPECTION_VIEW)');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(scopeIndex).toBeGreaterThan(dashboardIndex);
    expect(permissionIndex).toBeGreaterThan(scopeIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('maps malformed ids to the existing inspection-not-found privacy surface', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain("{ error: 'Inspection not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
