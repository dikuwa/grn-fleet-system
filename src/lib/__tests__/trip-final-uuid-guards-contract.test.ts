import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const reconciliation = read(
  'src/app/api/trips/[id]/return-declarations/reconcile/route.ts',
);
const authorityPdf = read('src/app/api/trips/[id]/authority/pdf/route.ts');

describe('final dynamic trip UUID guards', () => {
  it('keeps return reconciliation authorization ahead of the privacy-preserving trip guard', () => {
    const authIndex = reconciliation.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = reconciliation.indexOf("'/dashboard/trips/closure-review'");
    const permissionIndex = reconciliation.indexOf(
      'const permissionCheck = await requirePermission(session, Permissions.TRIP_CLOSE)',
    );
    const paramsIndex = reconciliation.indexOf('const { id: tripId } = await context.params');
    const guardIndex = reconciliation.indexOf('if (!UUID_PATTERN.test(tripId))');
    const dbIndex = reconciliation.indexOf('const db = getDb()');

    expect(reconciliation).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(paramsIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(paramsIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(reconciliation).toContain("{ error: 'Trip Authority not found' }, { status: 404 }");
    expect(reconciliation).toContain('return_declaration_reconciliation_conflict');
  });

  it('keeps authority PDF route and file permissions ahead of the scoped trip guard', () => {
    const authIndex = authorityPdf.indexOf('const auth = await requireRequestAuth(request)');
    const routeIndex = authorityPdf.indexOf(
      "requireDashboardAction(session, '/dashboard/trips', 'view')",
    );
    const permissionIndex = authorityPdf.indexOf(
      'const permission = await requirePermission(session, Permissions.FILE_VIEW)',
    );
    const rolesIndex = authorityPdf.indexOf('const roleNames = await getSessionRoleNames(session)');
    const accessIndex = authorityPdf.indexOf(
      "const access = resolveDashboardAccess('/dashboard/trips', roleNames)",
    );
    const paramsIndex = authorityPdf.indexOf('const { id } = await params');
    const guardIndex = authorityPdf.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = authorityPdf.indexOf('const db = getDb()');

    expect(authorityPdf).toContain('const UUID_PATTERN =');
    expect(routeIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(routeIndex);
    expect(rolesIndex).toBeGreaterThan(permissionIndex);
    expect(accessIndex).toBeGreaterThan(rolesIndex);
    expect(paramsIndex).toBeGreaterThan(accessIndex);
    expect(guardIndex).toBeGreaterThan(paramsIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(authorityPdf).toContain("{ error: 'Trip Authority not found' }, { status: 404 }");
    expect(authorityPdf).toContain('tripScopeCondition({');
    expect(authorityPdf).toContain("'Content-Type': 'application/pdf'");
  });
});
