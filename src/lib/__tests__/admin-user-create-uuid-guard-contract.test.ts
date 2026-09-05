import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/route.ts'),
  'utf8',
);

describe('admin user creation UUID boundary contract', () => {
  it('preserves required employee validation before the malformed employee UUID guard', () => {
    const required = source.indexOf('An employee record is required');
    const guard = source.indexOf("typeof employeeId !== 'string' || !UUID_PATTERN.test(employeeId)", required);
    const notFound = source.indexOf('Active employee not found', guard);
    const db = source.indexOf('const db = getDb()', guard);

    expect(guard).toBeGreaterThan(required);
    expect(notFound).toBeGreaterThan(guard);
    expect(db).toBeGreaterThan(notFound);
  });

  it('keeps the role UUID guard after the entitlement check and before role lookup', () => {
    const entitlement = source.indexOf("checkEntitlement(entitlements, 'users'");
    const guard = source.indexOf("roleId && (typeof roleId !== 'string' || !UUID_PATTERN.test(roleId))", entitlement);
    const notFound = source.indexOf('Role not found in your organisation', guard);
    const query = source.indexOf('eq(roles.id, roleId)', guard);

    expect(entitlement).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(entitlement);
    expect(notFound).toBeGreaterThan(guard);
    expect(query).toBeGreaterThan(notFound);
  });
});
