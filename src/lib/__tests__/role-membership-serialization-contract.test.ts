import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const userRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/route.ts'),
  'utf8',
);
const delegationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/delegate/route.ts'),
  'utf8',
);

describe('role assignment and membership serialization', () => {
  it('locks the target user before creating a normal role assignment', () => {
    const addRole = userRoute.indexOf('if (addRoleId)');
    const transaction = userRoute.indexOf('await db.transaction', addRole);
    const userLock = userRoute.indexOf('lockUserMembershipInvariant(tx, id)', transaction);
    const membershipCheck = userRoute.indexOf('.from(tenantMemberships)', userLock);
    const insert = userRoute.indexOf('.insert(roleAssignments)', membershipCheck);

    expect(transaction).toBeGreaterThan(addRole);
    expect(userLock).toBeGreaterThan(transaction);
    expect(membershipCheck).toBeGreaterThan(userLock);
    expect(insert).toBeGreaterThan(membershipCheck);
  });

  it('locks the user while ending a normal role assignment', () => {
    const removeRole = userRoute.indexOf('if (removeRoleId)');
    const transaction = userRoute.indexOf('await db.transaction', removeRole);
    const userLock = userRoute.indexOf('lockUserMembershipInvariant(tx, id)', transaction);
    const update = userRoute.indexOf('.update(roleAssignments)', userLock);

    expect(userLock).toBeGreaterThan(transaction);
    expect(update).toBeGreaterThan(userLock);
  });

  it('rechecks active roles under the user lock before access removal', () => {
    const deleteRoute = userRoute.indexOf('export async function DELETE');
    const userLock = userRoute.indexOf('lockUserMembershipInvariant(tx, id)', deleteRoute);
    const roleRecheck = userRoute.indexOf('.from(roleAssignments)', userLock);
    const membershipUpdate = userRoute.indexOf('.update(tenantMemberships)', roleRecheck);

    expect(userLock).toBeGreaterThan(deleteRoute);
    expect(roleRecheck).toBeGreaterThan(userLock);
    expect(membershipUpdate).toBeGreaterThan(roleRecheck);
  });

  it('returns a controlled conflict when roles changed during account removal', () => {
    const branch = userRoute.indexOf("state: 'active-roles'");
    const response = userRoute.indexOf("removalResult.state === 'active-roles'", branch);
    const status = userRoute.indexOf('{ status: 409 }', response);

    expect(branch).toBeGreaterThan(-1);
    expect(response).toBeGreaterThan(branch);
    expect(status).toBeGreaterThan(response);
  });

  it('locks source and target users in deterministic order before delegation creation', () => {
    const post = delegationRoute.indexOf('export async function POST');
    const transaction = delegationRoute.indexOf('await db.transaction', post);
    const sortedUsers = delegationRoute.indexOf('[id, targetUserId].sort()', transaction);
    const firstLock = delegationRoute.indexOf('lockUserMembershipInvariant(tx, lockedUserId)', sortedUsers);
    const sourceMembership = delegationRoute.indexOf('.from(tenantMemberships)', firstLock);
    const insert = delegationRoute.indexOf('.insert(roleAssignments)', sourceMembership);

    expect(sortedUsers).toBeGreaterThan(transaction);
    expect(firstLock).toBeGreaterThan(sortedUsers);
    expect(sourceMembership).toBeGreaterThan(firstLock);
    expect(insert).toBeGreaterThan(sourceMembership);
  });

  it('locks the acting-role holder while ending a delegation', () => {
    const deleteRoute = delegationRoute.indexOf('export async function DELETE');
    const transaction = delegationRoute.indexOf('await db.transaction', deleteRoute);
    const userLock = delegationRoute.indexOf('lockUserMembershipInvariant(tx, membership.userId)', transaction);
    const update = delegationRoute.indexOf('.update(roleAssignments)', userLock);

    expect(userLock).toBeGreaterThan(transaction);
    expect(update).toBeGreaterThan(userLock);
  });
});
