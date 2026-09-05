import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/route.ts'),
  'utf8',
);

describe('admin user creation capacity serialization', () => {
  it('keeps validation and role lookup before the account transaction', () => {
    const requiredEmployee = source.indexOf('An employee record is required');
    const roleLookup = source.indexOf('eq(roles.id, roleId)', requiredEmployee);
    const transaction = source.indexOf('await db.transaction', roleLookup);

    expect(roleLookup).toBeGreaterThan(requiredEmployee);
    expect(transaction).toBeGreaterThan(roleLookup);
  });

  it('checks tenant capacity under the transaction lock before user inserts', () => {
    const transaction = source.indexOf('await db.transaction');
    const capacity = source.indexOf('checkTenantUserCapacityLocked(', transaction);
    const userInsert = source.indexOf('.insert(user)', capacity);
    const membershipInsert = source.indexOf('.insert(tenantMemberships)', userInsert);

    expect(capacity).toBeGreaterThan(transaction);
    expect(userInsert).toBeGreaterThan(capacity);
    expect(membershipInsert).toBeGreaterThan(userInsert);
  });

  it('does not perform the old unlocked membership count before the transaction', () => {
    const entitlements = source.indexOf('const entitlements = await getTenantEntitlements');
    const transaction = source.indexOf('await db.transaction', entitlements);
    const preflightCount = source.indexOf('.select({ total: count() })', entitlements);

    expect(transaction).toBeGreaterThan(entitlements);
    expect(preflightCount === -1 || preflightCount > transaction).toBe(true);
  });

  it('maps locked capacity rejection to the existing controlled 409', () => {
    const marker = source.indexOf('ADMIN_USER_LIMIT_REACHED');
    const catchBranch = source.indexOf("error.message.startsWith(`${ADMIN_USER_LIMIT_REACHED}:`)", marker);
    const status = source.indexOf('{ status: 409 }', catchBranch);

    expect(marker).toBeGreaterThan(-1);
    expect(catchBranch).toBeGreaterThan(marker);
    expect(status).toBeGreaterThan(catchBranch);
  });
});
