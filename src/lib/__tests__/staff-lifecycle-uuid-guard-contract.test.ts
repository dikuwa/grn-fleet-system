import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff lifecycle UUID guards', () => {
  it('rejects malformed employee ids before the shared employee lookup reaches the database', () => {
    const helperIndex = source.indexOf('async function getEmployee(id: string, tenantId: string)');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id)) return undefined;', helperIndex);
    const dbIndex = source.indexOf('const db = getDb();', helperIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(helperIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(helperIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps auth and permission checks ahead of lifecycle employee resolution', () => {
    const patchIndex = source.indexOf('export async function PATCH');
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)', patchIndex);
    const dashboardIndex = source.indexOf("requireDashboardAction(auth.session, '/dashboard/staff', 'update')", patchIndex);
    const permissionIndex = source.indexOf('Permissions.STAFF_LIFECYCLE_MANAGE', dashboardIndex);
    const employeeIndex = source.indexOf('const employee = await getEmployee(id, auth.session.tenantId)', patchIndex);

    expect(authIndex).toBeGreaterThan(patchIndex);
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(dashboardIndex);
    expect(employeeIndex).toBeGreaterThan(permissionIndex);
  });

  it('validates transfer reference UUIDs before tenant-scoped database lookups', () => {
    const transferIndex = source.indexOf("body.action === 'transfer'");
    const officeGuardIndex = source.indexOf('if (!UUID_PATTERN.test(body.officeId))', transferIndex);
    const departmentGuardIndex = source.indexOf('if (body.departmentId && !UUID_PATTERN.test(body.departmentId))', transferIndex);
    const supervisorGuardIndex = source.indexOf('if (body.supervisorEmployeeId && !UUID_PATTERN.test(body.supervisorEmployeeId))', transferIndex);
    const lookupIndex = source.indexOf('const [[office], [department], [supervisor]] = await Promise.all([', transferIndex);

    expect(officeGuardIndex).toBeGreaterThan(transferIndex);
    expect(departmentGuardIndex).toBeGreaterThan(officeGuardIndex);
    expect(supervisorGuardIndex).toBeGreaterThan(departmentGuardIndex);
    expect(lookupIndex).toBeGreaterThan(supervisorGuardIndex);

    expect(source.slice(officeGuardIndex, lookupIndex)).toContain('The selected office does not belong to this tenant.');
    expect(source.slice(departmentGuardIndex, lookupIndex)).toContain('The selected department does not belong to this tenant.');
    expect(source.slice(supervisorGuardIndex, lookupIndex)).toContain('The selected supervisor is not an active employee in this tenant.');
  });
});
