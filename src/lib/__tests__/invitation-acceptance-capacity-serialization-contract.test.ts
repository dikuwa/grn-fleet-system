import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'src/lib/platform/invitations.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/auth/accept-invite/route.ts'),
  'utf8',
);

describe('invitation acceptance capacity and identity serialization', () => {
  it('uses tenant capacity then shared identity lock before profile and membership state', () => {
    const accept = service.indexOf('export async function acceptInvitation');
    const transaction = service.indexOf('return db.transaction(async (tx) => {', accept);
    const capacityLock = service.indexOf('lockTenantUserCapacity(tx, invitation.tenantId)', transaction);
    const existingUserRead = service.indexOf('.from(user)', capacityLock);
    const userLock = service.indexOf('lockUserMembershipInvariant(tx, userId)', existingUserRead);
    const profileRead = service.indexOf('.from(userProfiles)', userLock);
    const membershipRead = service.indexOf('.from(tenantMemberships)', profileRead);

    expect(capacityLock).toBeGreaterThan(transaction);
    expect(existingUserRead).toBeGreaterThan(capacityLock);
    expect(userLock).toBeGreaterThan(existingUserRead);
    expect(profileRead).toBeGreaterThan(userLock);
    expect(membershipRead).toBeGreaterThan(profileRead);
  });

  it('checks a fresh tenant count only when acceptance consumes a capacity slot', () => {
    expect(service).toContain('CAPACITY_COUNTED_MEMBERSHIP_STATUSES');
    expect(service).toContain('const consumesCapacity =');
    expect(service).toContain('checkTenantUserCapacityLocked(');
    expect(service).toContain('throw new InvitationCapacityError(');
  });

  it('claims a non-active existing membership status before activating it', () => {
    const membershipRead = service.indexOf('const [existingMembership] = await tx');
    const activation = service.indexOf('const [activatedMembership] = await tx', membershipRead);
    const previousStatusClaim = service.indexOf('eq(tenantMemberships.status, existingMembership.status)', activation);
    const returning = service.indexOf('.returning({ id: tenantMemberships.id })', previousStatusClaim);

    expect(activation).toBeGreaterThan(membershipRead);
    expect(previousStatusClaim).toBeGreaterThan(activation);
    expect(returning).toBeGreaterThan(previousStatusClaim);
  });

  it('maps exhausted tenant capacity to a controlled 409 at the public acceptance API', () => {
    expect(route).toContain('InvitationCapacityError');
    expect(route).toContain('error instanceof InvitationCapacityError');
    expect(route).toContain('{ status: 409 }');
  });
});
