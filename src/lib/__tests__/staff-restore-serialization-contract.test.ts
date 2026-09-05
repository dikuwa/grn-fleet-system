import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);

describe('staff restore serialization contract', () => {
  it('runs restore account and employee state in one transaction', () => {
    const restore = source.indexOf("body.action === 'restore'");
    const transaction = source.indexOf('await db.transaction', restore);
    const employeeClaim = source.indexOf('updateEmployeeRevision(tx, employee', transaction);
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', transaction);

    expect(transaction).toBeGreaterThan(restore);
    expect(employeeClaim).toBeGreaterThan(transaction);
    expect(membershipUpdate).toBeGreaterThan(transaction);
    expect(source.indexOf('restoreArchivedAccountIfAllowed(', restore)).toBe(-1);
  });

  it('locks tenant capacity before the user membership invariant', () => {
    const restore = source.indexOf("body.action === 'restore'");
    const transaction = source.indexOf('await db.transaction', restore);
    const capacityLock = source.indexOf('lockTenantUserCapacity(tx, auth.session.tenantId)', transaction);
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, employee.userId)', capacityLock);

    expect(capacityLock).toBeGreaterThan(transaction);
    expect(userLock).toBeGreaterThan(capacityLock);
  });

  it('re-reads membership and global profile after the locks', () => {
    const userLock = source.indexOf('lockUserMembershipInvariant(tx, employee.userId)');
    const membershipRead = source.indexOf('.from(tenantMemberships)', userLock);
    const profileRead = source.indexOf('.from(userProfiles)', membershipRead);

    expect(membershipRead).toBeGreaterThan(userLock);
    expect(profileRead).toBeGreaterThan(membershipRead);
  });

  it('checks locked user capacity only when an inactive membership will be restored', () => {
    const restore = source.indexOf("body.action === 'restore'");
    const inactiveCheck = source.indexOf("membership?.status === 'inactive'", restore);
    const capacity = source.indexOf('checkTenantUserCapacityLocked(', inactiveCheck);
    const membershipUpdate = source.indexOf('.update(tenantMemberships)', capacity);

    expect(inactiveCheck).toBeGreaterThan(restore);
    expect(capacity).toBeGreaterThan(inactiveCheck);
    expect(membershipUpdate).toBeGreaterThan(capacity);
  });

  it('uses the employee revision claim before dependent driver writes', () => {
    const restore = source.indexOf("body.action === 'restore'");
    const employeeClaim = source.indexOf('updateEmployeeRevision(tx, employee', restore);
    const driverUpdate = source.indexOf('.update(driverProfiles)', employeeClaim);

    expect(employeeClaim).toBeGreaterThan(restore);
    expect(driverUpdate).toBeGreaterThan(employeeClaim);
  });
});
