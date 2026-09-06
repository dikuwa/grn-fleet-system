import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff archive tenant/user invariants', () => {
  it('uses the global user then tenant-admin lock order for the archive recount', () => {
    const helper = source.indexOf('async function wouldDisableFinalTenantAdmin(');
    const userLock = source.indexOf('lockUserMembershipInvariant(executor, userId)', helper);
    const tenantLock = source.indexOf('lockTenantAdministratorInvariant(executor, tenantId)', userLock);

    expect(helper).toBeGreaterThan(-1);
    expect(userLock).toBeGreaterThan(helper);
    expect(tenantLock).toBeGreaterThan(userLock);
  });

  it('checks final-admin coverage inside the archive transaction before fresh membership reads', () => {
    const archive = source.indexOf("body.action === 'archive'");
    const transaction = source.indexOf('runLifecycleTransaction', archive);
    const finalAdmin = source.indexOf('wouldDisableFinalTenantAdmin(', transaction);
    const membershipRead = source.indexOf('.from(tenantMemberships)', finalAdmin);

    expect(transaction).toBeGreaterThan(archive);
    expect(finalAdmin).toBeGreaterThan(transaction);
    expect(membershipRead).toBeGreaterThan(finalAdmin);
  });

  it('re-reads tenant and other memberships before claiming the employee revision', () => {
    const archive = source.indexOf("body.action === 'archive'");
    const transaction = source.indexOf('runLifecycleTransaction', archive);
    const finalAdmin = source.indexOf('wouldDisableFinalTenantAdmin(', transaction);
    const membershipRead = source.indexOf('.from(tenantMemberships)', finalAdmin);
    const otherMembershipRead = source.indexOf('.from(tenantMemberships)', membershipRead + 1);
    const employeeClaim = source.indexOf('updateEmployeeRevision(tx, employee', otherMembershipRead);

    expect(membershipRead).toBeGreaterThan(finalAdmin);
    expect(otherMembershipRead).toBeGreaterThan(membershipRead);
    expect(employeeClaim).toBeGreaterThan(otherMembershipRead);
  });

  it('conditionally claims the active tenant membership before any global profile disable', () => {
    const archive = source.indexOf("body.action === 'archive'");
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', archive);
    const activeClaim = source.indexOf("eq(tenantMemberships.status, 'active')", membershipUpdate);
    const returning = source.indexOf('.returning({ id: tenantMemberships.id })', activeClaim);
    const profileUpdate = source.indexOf('.update(userProfiles)', returning);

    expect(membershipUpdate).toBeGreaterThan(archive);
    expect(activeClaim).toBeGreaterThan(membershipUpdate);
    expect(returning).toBeGreaterThan(activeClaim);
    expect(profileUpdate).toBeGreaterThan(returning);
  });

  it('maps final-admin archive protection to a controlled 409 response', () => {
    const marker = source.indexOf('StaffArchiveFinalAdminError');
    const response = source.indexOf('final active Tenant Administrator', marker);
    const status = source.indexOf('{ status: 409 }', response);

    expect(marker).toBeGreaterThan(-1);
    expect(response).toBeGreaterThan(marker);
    expect(status).toBeGreaterThan(response);
  });
});
