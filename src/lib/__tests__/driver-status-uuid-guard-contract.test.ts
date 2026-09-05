import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/status/route.ts'),
  'utf8',
);

describe('driver status UUID guard', () => {
  it('preserves auth, permissions and body validation before the id guard', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const dashboardIndex = source.indexOf("requireDashboardAction(session, '/dashboard/drivers', 'update')");
    const permissionIndex = source.indexOf('const permCheck = await requireAnyPermission(session');
    const actionValidationIndex = source.indexOf('if (!validActions.includes(action))');
    const dateValidationIndex = source.indexOf('if (!Number.isFinite(effectiveAt.getTime()))');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(dashboardIndex);
    expect(actionValidationIndex).toBeGreaterThan(permissionIndex);
    expect(dateValidationIndex).toBeGreaterThan(actionValidationIndex);
    expect(guardIndex).toBeGreaterThan(dateValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('uses the existing employee-not-found privacy surface', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain("{ error: 'Employee not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
