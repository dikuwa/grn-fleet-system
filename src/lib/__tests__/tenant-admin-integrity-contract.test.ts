import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/tenant-admin-integrity.ts'),
  'utf8',
);

describe('tenant administrator invariant helper', () => {
  it('takes a tenant-scoped transaction advisory lock before recounting admins', () => {
    const helper = source.indexOf('lockTenantAdministratorInvariant');
    const lock = source.indexOf('pg_advisory_xact_lock', helper);
    const recount = source.indexOf('.from(roleAssignments)', lock);

    expect(helper).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(helper);
    expect(recount).toBeGreaterThan(lock);
  });

  it('counts only currently active Tenant Administrator assignments', () => {
    expect(source).toContain("eq(tenantMemberships.status, 'active')");
    expect(source).toContain("eq(roles.name, 'Tenant Administrator')");
    expect(source).toContain('lte(roleAssignments.startDate, now)');
    expect(source).toContain('or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now))');
  });

  it('only identifies the target when exactly one active administrator remains', () => {
    expect(source).toContain('activeAdminUserIds.size === 1 && activeAdminUserIds.has(userId)');
  });
});
