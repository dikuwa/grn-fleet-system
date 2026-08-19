import { describe, expect, it } from 'vitest';
import {
  canTenantOperate,
  normalizeSubscriptionStatus,
  type TenantEntitlements,
} from '@/lib/entitlements';

function entitlement(subscriptionStatus: TenantEntitlements['subscriptionStatus']): TenantEntitlements {
  return {
    tenantId: 'tenant-1',
    name: 'Test Tenant',
    status: 'ACTIVE',
    lifecycleStatus: 'ACTIVE',
    planCode: 'STANDARD',
    subscriptionStatus,
    trialEndsAt: null,
    vehicleLimit: 10,
    userLimit: 25,
    storageLimit: 5,
    features: [],
    packageName: 'Standard',
    subscriptionActive: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD'].includes(subscriptionStatus),
  };
}

describe('subscription entitlement status', () => {
  it('prefers the live subscription row over a stale tenant mirror', () => {
    expect(normalizeSubscriptionStatus('grace_period', 'PAST_DUE')).toBe('GRACE_PERIOD');
    expect(normalizeSubscriptionStatus('suspended', 'ACTIVE')).toBe('SUSPENDED');
  });

  it('falls back to the legacy tenant mirror when no subscription row exists', () => {
    expect(normalizeSubscriptionStatus(undefined, 'ACTIVE')).toBe('ACTIVE');
    expect(normalizeSubscriptionStatus(undefined, 'EXPIRED')).toBe('EXPIRED');
  });

  it('allows operation during a configured grace period', () => {
    expect(canTenantOperate(entitlement('GRACE_PERIOD'))).toEqual({ ok: true });
  });

  it('blocks suspended subscriptions even when tenant lifecycle is active', () => {
    const result = canTenantOperate(entitlement('SUSPENDED'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('suspended');
  });

  it('continues blocking expired, cancelled, past-due and restricted subscriptions', () => {
    for (const status of ['EXPIRED', 'CANCELLED', 'PAST_DUE', 'RESTRICTED'] as const) {
      expect(canTenantOperate(entitlement(status)).ok).toBe(false);
    }
  });
});
