import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff archive tenant/user invariants', () => {
  it('locks final-admin coverage before the user membership invariant', () => {
    const archive = source.indexOf("body.action === 'archive'");
    const transaction = source.indexOf('runLifecycleTransaction', archive);
    const finalAdmin = source.indexOf('wouldDisableFinalActiveTenantAdministrator(', transaction);
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, employee.userId)', finalAdmin);

    expect(finalAdmin).toBeGreaterThan(transaction);
    expect(userLock).toBeGreaterThan(finalAdmin);
  });

  it('re-reads the tenant membership and other memberships after locking', () => {
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, employee.userId)');
    const membershipRead = source.indexOf('.from(tenantMemberships)', userLock);
    const otherMembershipRead = source.indexOf('.from(tenantMemberships)', membershipRead + 1);
    const employeeClaim = source.indexOf('updateEmployeeRevision(tx, employee', otherMembershipRead);

    expect(membershipRead).toBeGreaterThan(userLock);
    expect(otherMembershipRead).toBeGreaterThan(membershipRead);
    expect(employeeClaim).toBeGreaterThan(otherMembershipRead);
  });

  it('conditionally claims an active membership before global disable', () => {
    const archive = source.indexOf("body.action === 'archive'");
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', archive);
    const activeClaim = source.indexOf("eq(tenantMemberships.status, 'active')", membershipUpdate);
    const returning = source.indexOf('.returning({ id: tenantMemberships.id })', activeClaim);
    const profileUpdate = source.indexOf('.update(userProfiles)', returning);

    expect(activeClaim).toBeGreaterThan(membershipUpdate);
    expect(returning).toBeGreaterThan(activeClaim);
    expect(profileUpdate).toBeGreaterThan(returning);
  });

  it('maps final-admin archive protection to the existing 409 surface', () => {
    const marker = source.indexOf('StaffArchiveFinalAdminError');
    const response = source.indexOf('final active Tenant Administrator', marker);
    const status = source.indexOf('{ status: 409 }', response);

    expect(marker).toBeGreaterThan(-1);
    expect(response).toBeGreaterThan(marker);
    expect(status).toBeGreaterThan(response);
  });
});
