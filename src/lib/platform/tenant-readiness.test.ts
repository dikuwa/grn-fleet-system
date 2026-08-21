import { describe, expect, it } from 'vitest';
import {
  hasRequiredInspectionTemplates,
  isActivationSubscriptionReady,
} from './tenant-readiness';
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

describe('hasRequiredInspectionTemplates', () => {
  it('requires both active departure and return inspection template types', () => {
    expect(hasRequiredInspectionTemplates([])).toBe(false);
    expect(hasRequiredInspectionTemplates(['departure'])).toBe(false);
    expect(hasRequiredInspectionTemplates(['return'])).toBe(false);
    expect(hasRequiredInspectionTemplates(['departure', 'return'])).toBe(true);
  });

  it('ignores duplicate and unrelated template types', () => {
    expect(hasRequiredInspectionTemplates(['departure', 'departure', 'other'])).toBe(false);
    expect(hasRequiredInspectionTemplates(['other', 'return', 'departure'])).toBe(true);
  });
});
