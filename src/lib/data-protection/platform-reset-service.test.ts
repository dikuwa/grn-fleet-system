import { describe, expect, it } from 'vitest';
import {
  PLATFORM_OPERATIONAL_PRESERVED,
  PLATFORM_OPERATIONAL_TABLES,
  platformOperationalResetFingerprint,
} from './platform-reset-service';

describe('platform operational reset boundary', () => {
  it('only targets disposable platform operational records', () => {
    expect(PLATFORM_OPERATIONAL_TABLES).toEqual([
      'cms_enquiries',
      'demo_requests',
      'notifications',
      'notification_deliveries',
      'notification_reads',
      'notification_dismissals',
    ]);
    expect(PLATFORM_OPERATIONAL_TABLES).not.toContain('tenants');
    expect(PLATFORM_OPERATIONAL_TABLES).not.toContain('users');
    expect(PLATFORM_OPERATIONAL_TABLES).not.toContain('payments');
    expect(PLATFORM_OPERATIONAL_PRESERVED).toContain('Tenants and tenant operational data');
    expect(PLATFORM_OPERATIONAL_PRESERVED).toContain('Payments and financial records');
    expect(PLATFORM_OPERATIONAL_PRESERVED).toContain('Audit events');
    expect(PLATFORM_OPERATIONAL_PRESERVED).toContain(
      'Open Platform Admin action-required notifications',
    );
  });

  it('uses a stable fingerprint and detects a changed reset plan', () => {
    const first = platformOperationalResetFingerprint({
      enquiryIds: ['b', 'a'],
      demoRequestIds: ['d'],
      notificationIds: ['n'],
    });
    const reordered = platformOperationalResetFingerprint({
      enquiryIds: ['a', 'b'],
      demoRequestIds: ['d'],
      notificationIds: ['n'],
    });
    const changed = platformOperationalResetFingerprint({
      enquiryIds: ['a', 'b', 'c'],
      demoRequestIds: ['d'],
      notificationIds: ['n'],
    });

    expect(first).toBe(reordered);
    expect(changed).not.toBe(first);
  });
});
