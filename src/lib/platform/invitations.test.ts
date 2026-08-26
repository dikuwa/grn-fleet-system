import { describe, expect, it } from 'vitest';
import { isActiveInvitationIdentityProfile, shouldStartTenantSetup } from './invitations';

describe('shouldStartTenantSetup', () => {
  it.each(['DRAFT', 'PENDING_INVITATION', 'INVITATION_SENT', 'INVITATION_EXPIRED'])(
    'starts setup for a first Tenant Administrator invitation from %s',
    (lifecycleStatus) => {
      expect(shouldStartTenantSetup('tenant_admin', lifecycleStatus)).toBe(true);
    },
  );

  it.each(['SETUP_IN_PROGRESS', 'PENDING_PLATFORM_REVIEW', 'READY_FOR_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'RESTRICTED', 'ARCHIVED'])(
    'does not regress a tenant already at %s',
    (lifecycleStatus) => {
      expect(shouldStartTenantSetup('tenant_admin', lifecycleStatus)).toBe(false);
    },
  );

  it.each(['department_admin', 'driver', 'inspector', 'custom'])(
    'never changes lifecycle for a %s invitation',
    (invitationType) => {
      expect(shouldStartTenantSetup(invitationType, 'ACTIVE')).toBe(false);
      expect(shouldStartTenantSetup(invitationType, 'PENDING_INVITATION')).toBe(false);
    },
  );
});

describe('isActiveInvitationIdentityProfile', () => {
  it('accepts only an enabled active identity', () => {
    expect(isActiveInvitationIdentityProfile({ status: 'active', accountEnabled: true })).toBe(
      true,
    );
  });

  it.each([
    [{ status: 'suspended', accountEnabled: true }],
    [{ status: 'active', accountEnabled: false }],
    [null],
    [undefined],
  ])('rejects a disabled or missing lifecycle profile: %s', (profile) => {
    expect(isActiveInvitationIdentityProfile(profile)).toBe(false);
  });
});
