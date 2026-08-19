import { describe, expect, it } from 'vitest';
import { shouldStartTenantSetup } from './invitations';

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
