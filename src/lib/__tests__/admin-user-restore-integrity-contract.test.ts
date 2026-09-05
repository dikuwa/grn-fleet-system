import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/restore/route.ts'),
  'utf8',
);

describe('admin user restore integrity contract', () => {
  it('keeps membership existence/state validation before the transaction', () => {
    const membership = source.indexOf('const [membership] = await db');
    const missing = source.indexOf("User not found in your organisation", membership);
    const state = source.indexOf("membership.status !== 'access_removed'", missing);
    const transaction = source.indexOf('await db.transaction', state);

    expect(membership).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(membership);
    expect(state).toBeGreaterThan(missing);
    expect(transaction).toBeGreaterThan(state);
  });

  it('locks capacity before the user-scoped membership invariant', () => {
    const transaction = source.indexOf('await db.transaction');
    const capacity = source.indexOf('checkTenantUserCapacityLocked(', transaction);
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, id)', capacity);
    const restore = source.indexOf('.update(tenantMemberships)', userLock);

    expect(capacity).toBeGreaterThan(transaction);
    expect(userLock).toBeGreaterThan(capacity);
    expect(restore).toBeGreaterThan(userLock);
  });

  it('re-reads global profile state only after acquiring the user lock', () => {
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, id)');
    const profileRead = source.indexOf('.from(userProfiles)', userLock);
    const removedCheck = source.indexOf("profile?.status === 'removed'", profileRead);
    const profileUpdate = source.indexOf('.update(userProfiles)', removedCheck);

    expect(profileRead).toBeGreaterThan(userLock);
    expect(removedCheck).toBeGreaterThan(profileRead);
    expect(profileUpdate).toBeGreaterThan(removedCheck);
  });

  it('maps a locked capacity rejection to the existing 409 surface', () => {
    const marker = source.indexOf('USER_LIMIT_REACHED');
    const catchBranch = source.indexOf("error.message.startsWith(`${USER_LIMIT_REACHED}:`)", marker);
    const status = source.indexOf('{ status: 409 }', catchBranch);

    expect(catchBranch).toBeGreaterThan(marker);
    expect(status).toBeGreaterThan(catchBranch);
  });
});
