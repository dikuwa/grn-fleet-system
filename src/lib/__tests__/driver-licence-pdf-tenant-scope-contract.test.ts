import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/me/licences/[id]/pdf/route.ts'),
  'utf8',
);

describe('driver licence PDF tenant scope contract', () => {
  it('binds the authoritative licence lookup to the authenticated tenant', () => {
    expect(routeSource).toContain("import { and, eq } from 'drizzle-orm';");
    expect(routeSource).toContain('eq(driverLicences.id, licenceId)');
    expect(routeSource).toContain('eq(employees.tenantId, session.tenantId)');
    expect(routeSource).toContain('.where(\n        and(');
  });

  it('evaluates owner or manager access only after the tenant-scoped lookup', () => {
    const tenantPredicate = routeSource.indexOf('eq(employees.tenantId, session.tenantId)');
    const ownerCheck = routeSource.indexOf('const isOwn = licence.employeeUserId === session.user.id;');
    const managerCheck = routeSource.indexOf(
      'const canManage = await hasPermission(session, Permissions.DRIVER_MANAGE);',
    );

    expect(tenantPredicate).toBeGreaterThan(-1);
    expect(ownerCheck).toBeGreaterThan(tenantPredicate);
    expect(managerCheck).toBeGreaterThan(tenantPredicate);
  });

  it('returns not found for IDs outside the tenant before authorization can reveal existence', () => {
    expect(routeSource).toContain("return NextResponse.json({ error: 'Licence not found' }, { status: 404 });");
  });
});
