import { describe, expect, it } from 'vitest';
import { isActivationSubscriptionReady } from './tenant-readiness';
import type { SubscriptionStatusType } from '@/lib/entitlements';

describe('isActivationSubscriptionReady', () => {
  it.each<SubscriptionStatusType>(['TRIALING', 'ACTIVE', 'GRACE_PERIOD'])(
    'allows %s subscriptions for activation readiness',
    (status) => {
      expect(isActivationSubscriptionReady(status)).toBe(true);
    },
  );

  it.each<SubscriptionStatusType>([
    'NOT_CONFIGURED',
    'PENDING_PAYMENT',
    'PAST_DUE',
    'CANCELLED',
    'EXPIRED',
    'SUSPENDED',
    'RESTRICTED',
  ])('blocks %s subscriptions from activation readiness', (status) => {
    expect(isActivationSubscriptionReady(status)).toBe(false);
  });
});
