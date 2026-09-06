import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/route.ts'),
  'utf8',
);

describe('admin user invariant serialization', () => {
  it('checks final-admin protection inside the membership status transaction', () => {
    const patchRoute = source.indexOf('export async function PATCH');
    const transaction = source.indexOf('await db.transaction', patchRoute);
    const finalAdmin = source.indexOf('wouldDisableFinalActiveTenantAdministrator(', transaction);
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', finalAdmin);

    expect(transaction).toBeGreaterThan(patchRoute);
    expect(finalAdmin).toBeGreaterThan(transaction);
    expect(membershipUpdate).toBeGreaterThan(finalAdmin);
  });

  it('claims the reviewed membership status before audit success', () => {
    const statusUpdate = source.indexOf('.update(tenantMemberships)', source.indexOf('export async function PATCH'));
    const statusClaim = source.indexOf('eq(tenantMemberships.status, membership.status)', statusUpdate);
    const returning = source.indexOf('.returning({ id: tenantMemberships.id })', statusClaim);
    const audit = source.indexOf('user_account_updated', returning);

    expect(statusClaim).toBeGreaterThan(statusUpdate);
    expect(returning).toBeGreaterThan(statusClaim);
    expect(audit).toBeGreaterThan(returning);
  });

  it('locks final-admin coverage before ending an active Tenant Administrator role', () => {
    const removeRole = source.indexOf('if (removeRoleId)');
    const transaction = source.indexOf('await db.transaction', removeRole);
    const finalAdmin = source.indexOf('wouldDisableFinalActiveTenantAdministrator(', transaction);
    const assignmentUpdate = source.indexOf('.update(roleAssignments)', finalAdmin);

    expect(transaction).toBeGreaterThan(removeRole);
    expect(finalAdmin).toBeGreaterThan(transaction);
    expect(assignmentUpdate).toBeGreaterThan(finalAdmin);
  });

  it('claims the reviewed role-assignment end state before audit success', () => {
    const removeRole = source.indexOf('if (removeRoleId)');
    const endRevision = source.indexOf('assignmentEndRevisionMatches(assignment.endDate)', removeRole);
    const returning = source.indexOf('.returning({ id: roleAssignments.id })', endRevision);
    const audit = source.indexOf('role_assignment_ended', returning);

    expect(endRevision).toBeGreaterThan(removeRole);
    expect(returning).toBeGreaterThan(endRevision);
    expect(audit).toBeGreaterThan(returning);
  });

  it('locks the global user membership invariant before recounting other memberships on delete', () => {
    const deleteRoute = source.indexOf('export async function DELETE');
    const transaction = source.indexOf('await db.transaction', deleteRoute);
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, id)', transaction);
    const otherMemberships = source.indexOf('.from(tenantMemberships)', userLock);
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', otherMemberships);

    expect(userLock).toBeGreaterThan(transaction);
    expect(otherMemberships).toBeGreaterThan(userLock);
    expect(membershipUpdate).toBeGreaterThan(otherMemberships);
  });

  it('claims the reviewed membership state before global account revocation', () => {
    const deleteRoute = source.indexOf('export async function DELETE');
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', deleteRoute);
    const statusClaim = source.indexOf('eq(tenantMemberships.status, membership.status)', membershipUpdate);
    const returning = source.indexOf('.returning({ id: tenantMemberships.id })', statusClaim);
    const sessionDelete = source.indexOf('.delete(sessionTable)', returning);

    expect(statusClaim).toBeGreaterThan(membershipUpdate);
    expect(returning).toBeGreaterThan(statusClaim);
    expect(sessionDelete).toBeGreaterThan(returning);
  });
});
