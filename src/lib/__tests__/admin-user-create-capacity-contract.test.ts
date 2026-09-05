import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/route.ts'),
  'utf8',
);

describe('admin user creation capacity serialization', () => {
  it('keeps ordinary validation before the account transaction', () => {
    const requiredEmployee = source.indexOf('An employee record is required');
    const existingUser = source.indexOf('A user with this email already exists', requiredEmployee);
    const transaction = source.indexOf('await db.transaction', existingUser);

    expect(existingUser).toBeGreaterThan(requiredEmployee);
    expect(transaction).toBeGreaterThan(existingUser);
  });

  it('checks tenant capacity before role validation and all account inserts', () => {
    const transaction = source.indexOf('await db.transaction');
    const capacity = source.indexOf('checkTenantUserCapacityLocked(', transaction);
    const roleGuard = source.indexOf("roleId && (typeof roleId !== 'string' || !UUID_PATTERN.test(roleId))", capacity);
    const roleLookup = source.indexOf('eq(roles.id, roleId)', roleGuard);
    const userInsert = source.indexOf('.insert(user)', roleLookup);
    const membershipInsert = source.indexOf('.insert(tenantMemberships)', userInsert);

    expect(capacity).toBeGreaterThan(transaction);
    expect(roleGuard).toBeGreaterThan(capacity);
    expect(roleLookup).toBeGreaterThan(roleGuard);
    expect(userInsert).toBeGreaterThan(roleLookup);
    expect(membershipInsert).toBeGreaterThan(userInsert);
  });

  it('does not perform the old unlocked membership count before the transaction', () => {
    const entitlements = source.indexOf('const entitlements = await getTenantEntitlements');
    const transaction = source.indexOf('await db.transaction', entitlements);
    const preflightCount = source.indexOf('.select({ total: count() })', entitlements);

    expect(transaction).toBeGreaterThan(entitlements);
    expect(preflightCount === -1 || preflightCount > transaction).toBe(true);
  });

  it('maps locked capacity and role validation rejections to controlled surfaces', () => {
    const capacityMarker = source.indexOf('ADMIN_USER_LIMIT_REACHED');
    const capacityCatch = source.indexOf("error.message.startsWith(`${ADMIN_USER_LIMIT_REACHED}:`)", capacityMarker);
    const roleMarker = source.indexOf('ADMIN_ROLE_NOT_FOUND');
    const roleCatch = source.indexOf('error.message === ADMIN_ROLE_NOT_FOUND', roleMarker);

    expect(capacityCatch).toBeGreaterThan(capacityMarker);
    expect(source.indexOf('{ status: 409 }', capacityCatch)).toBeGreaterThan(capacityCatch);
    expect(roleCatch).toBeGreaterThan(roleMarker);
    expect(source.indexOf('{ status: 404 }', roleCatch)).toBeGreaterThan(roleCatch);
  });
});
