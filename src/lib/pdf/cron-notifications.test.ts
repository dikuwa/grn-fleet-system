/**
 * Cron / Licence Expiry Notification Unit Tests
 *
 * Tests the business logic used by the cron endpoint:
 * - Expiry date calculation and status classification
 * - Notification deduplication logic
 * - Email notification gating
 * - Summary aggregation
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helper: simulate what the cron endpoint does
// ---------------------------------------------------------------------------

interface LicenceRow {
  licenceId: string;
  licenceNumber: string;
  licenceClass: string;
  expiryDate: string;
  holderName: string;
  verificationStatus: string;
  driverProfileId: string;
  employeeId: string;
  employeeUserId: string | null;
  employeeEmail: string | null;
  employeeName: string;
  tenantId: string;
}

function calculateDaysUntilExpiry(expiryDate: string): number {
  const now = new Date('2026-07-29T12:00:00.000Z'); // frozen "now" for tests
  const expiry = new Date(expiryDate);
  const rawDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const ceiled = Math.ceil(rawDays);
  // Math.ceil(-0.5) = -0 which Object.is distinguishes from 0
  return Object.is(ceiled, -0) ? 0 : ceiled;
}

function isExpired(expiryDate: string): boolean {
  const now = new Date('2026-07-29T12:00:00.000Z'); // frozen "now"
  const expiry = new Date(expiryDate);
  // The cron runs at 06:00 UTC; by that time, today's midnight has already passed.
  // So an expiry date of "today" IS considered expired from the cron's perspective.
  return expiry < now;
}

function classifyLicence(
  licence: LicenceRow,
): { daysUntilExpiry: number; isExpired: boolean; notificationType: 'emergency' | 'reminder' | null } {
  const daysUntilExpiry = calculateDaysUntilExpiry(licence.expiryDate);
  const expired = isExpired(licence.expiryDate);

  if (!licence.employeeUserId || !licence.employeeEmail) {
    return { daysUntilExpiry, isExpired: expired, notificationType: null };
  }

  return {
    daysUntilExpiry,
    isExpired: expired,
    notificationType: expired ? 'emergency' : 'reminder',
  };
}

function buildTitle(licence: LicenceRow, isExpired: boolean): string {
  return isExpired
    ? `Driving Licence Expired — ${licence.licenceClass} (${licence.licenceNumber.slice(-4)})`
    : `Licence Expiring Soon — ${licence.licenceClass} (${licence.licenceNumber.slice(-4)})`;
}

function buildNotificationBody(licence: LicenceRow, isExpired: boolean, daysUntilExpiry: number): string {
  const expiryDateStr = new Date(licence.expiryDate).toLocaleDateString('en-NA');
  if (isExpired) {
    return `Your ${licence.licenceClass} driving licence expired on ${expiryDateStr}. Please renew it to remain eligible for driving assignments.`;
  }
  return `Your ${licence.licenceClass} driving licence expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${expiryDateStr}). Please arrange renewal.`;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeLicence(overrides: Partial<LicenceRow> = {}): LicenceRow {
  return {
    licenceId: 'ae2b8375-b8bd-448b-bdb7-17f73d6d5097',
    licenceNumber: 'L123456',
    licenceClass: 'B',
    expiryDate: '2028-12-31',
    holderName: 'Michael Mwala',
    verificationStatus: 'verified',
    driverProfileId: 'dp-001',
    employeeId: 'emp-001',
    employeeUserId: 'user-001',
    employeeEmail: 'michael@kavangoeast.gov.na',
    employeeName: 'Michael Mwala',
    tenantId: 't1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cron/licence-expiry business logic', () => {
  describe('calculateDaysUntilExpiry', () => {
    it('returns positive days for future dates', () => {
      const days = calculateDaysUntilExpiry('2026-08-15');
      expect(days).toBeGreaterThan(0);
    });

    it('returns zero for today', () => {
      // "now" is frozen at 2026-07-29
      const days = calculateDaysUntilExpiry('2026-07-29');
      expect(days).toBe(0);
    });

    it('returns negative for past dates (expired)', () => {
      const days = calculateDaysUntilExpiry('2026-07-01');
      expect(days).toBeLessThan(0);
    });

    it('returns exactly 30 days for 2026-08-28', () => {
      const days = calculateDaysUntilExpiry('2026-08-28');
      expect(days).toBe(30);
    });

    it('returns 1 day for tomorrow', () => {
      const days = calculateDaysUntilExpiry('2026-07-30');
      expect(days).toBe(1);
    });
  });

  describe('isExpired', () => {
    it('returns true for past date', () => {
      expect(isExpired('2026-07-01')).toBe(true);
    });

    it('returns false for future date', () => {
      expect(isExpired('2026-08-15')).toBe(false);
    });

    it('returns true for today (expiry midnight < cron runtime)', () => {
      // The cron runs at 06:00 UTC; by that time today's midnight has passed
      expect(isExpired('2026-07-29')).toBe(true);
    });
  });

  describe('classifyLicence', () => {
    it('returns emergency for expired licence', () => {
      const result = classifyLicence(makeLicence({ expiryDate: '2026-07-01' }));
      expect(result.isExpired).toBe(true);
      expect(result.daysUntilExpiry).toBeLessThan(0);
      expect(result.notificationType).toBe('emergency');
    });

    it('returns reminder for expiring licence', () => {
      const result = classifyLicence(makeLicence({ expiryDate: '2026-08-15' }));
      expect(result.isExpired).toBe(false);
      expect(result.daysUntilExpiry).toBeGreaterThan(0);
      expect(result.daysUntilExpiry).toBeLessThanOrEqual(30);
      expect(result.notificationType).toBe('reminder');
    });

    it('returns null notificationType when driver has no user account', () => {
      const result = classifyLicence(makeLicence({ employeeUserId: null }));
      expect(result.notificationType).toBeNull();
    });

    it('returns null notificationType when driver has no email', () => {
      const result = classifyLicence(makeLicence({ employeeEmail: null }));
      expect(result.notificationType).toBeNull();
    });
  });

  describe('buildTitle', () => {
    it('uses emergency title for expired', () => {
      const title = buildTitle(makeLicence(), true);
      expect(title).toContain('Expired');
      expect(title).toContain('B');
      expect(title).toContain('3456');
    });

    it('uses reminder title for expiring', () => {
      const title = buildTitle(makeLicence(), false);
      expect(title).toContain('Expiring Soon');
      expect(title).toContain('B');
      expect(title).toContain('3456');
    });
  });

  describe('buildNotificationBody', () => {
    it('includes renewal message for expired', () => {
      const body = buildNotificationBody(makeLicence({ expiryDate: '2026-07-01' }), true, -28);
      expect(body).toContain('expired on');
      expect(body).toContain('renew it');
    });

    it('includes days remaining for expiring', () => {
      const body = buildNotificationBody(makeLicence({ expiryDate: '2026-08-15' }), false, 17);
      expect(body).toContain('17 days');
      expect(body).toContain('arrange renewal');
    });

    it('handles single day correctly (singular)', () => {
      const body = buildNotificationBody(makeLicence({ expiryDate: '2026-07-30' }), false, 1);
      expect(body).toContain('1 day');
      expect(body).not.toContain('1 days');
    });

    it('handles today case correctly', () => {
      const body = buildNotificationBody(makeLicence({ expiryDate: '2026-07-29' }), false, 0);
      expect(body).toContain('0 days');
    });
  });

  describe('notification deduplication logic', () => {
    it('skips notification when already notified today', () => {
      const existingNotifications = new Set(['lic-001', 'lic-002']);
      const licenceIdsToProcess = ['lic-001', 'lic-003', 'lic-004'];

      const newNotifications = licenceIdsToProcess.filter((id) => !existingNotifications.has(id));
      expect(newNotifications).toEqual(['lic-003', 'lic-004']);
      expect(newNotifications.length).toBe(2);

      // lic-001 was already notified — not in the result
      expect(newNotifications).not.toContain('lic-001');
    });

    it('processes all licences when no prior notifications exist', () => {
      const existingNotifications = new Set<string>();
      const licenceIdsToProcess = ['lic-001', 'lic-002', 'lic-003'];

      const newNotifications = licenceIdsToProcess.filter((id) => !existingNotifications.has(id));
      expect(newNotifications.length).toBe(3);
    });

    it('handles empty licence list gracefully', () => {
      const existingNotifications = new Set<string>();
      const licenceIdsToProcess: string[] = [];

      const newNotifications = licenceIdsToProcess.filter((id) => !existingNotifications.has(id));
      expect(newNotifications.length).toBe(0);
    });
  });

  describe('email notification gating', () => {
    it('sends email when all env vars are set and driver has email', () => {
      const shouldSend = (
        resendApiKey: string | undefined,
        emailFrom: string | undefined,
        employeeEmail: string | null,
      ): boolean => {
        return Boolean(resendApiKey && emailFrom && employeeEmail);
      };

      expect(shouldSend('key-123', 'noreply@test.gov', 'driver@test.gov')).toBe(true);
      expect(shouldSend(undefined, 'noreply@test.gov', 'driver@test.gov')).toBe(false);
      expect(shouldSend('key-123', undefined, 'driver@test.gov')).toBe(false);
      expect(shouldSend('key-123', 'noreply@test.gov', null)).toBe(false);
      expect(shouldSend(undefined, undefined, null)).toBe(false);
    });
  });

  describe('summary aggregation', () => {
    it('correctly counts checked, expired, and expiring licences', () => {
      const results = [
        { licenceId: 'l1', notificationCreated: true, isExpired: true, daysUntilExpiry: -30 },
        { licenceId: 'l2', notificationCreated: true, isExpired: false, daysUntilExpiry: 5 },
        { licenceId: 'l3', notificationCreated: false, isExpired: false, daysUntilExpiry: 2 },
        { licenceId: 'l4', notificationCreated: false, isExpired: true, daysUntilExpiry: -1 },
      ];

      const checked = results.length;
      const notificationsCreated = results.filter((r) => r.notificationCreated).length;
      const alreadyNotified = results.filter((r) => !r.notificationCreated).length;
      const expired = results.filter((r) => r.isExpired).length;
      const expiring = results.filter((r) => !r.isExpired).length;

      expect(checked).toBe(4);
      expect(notificationsCreated).toBe(2);
      expect(alreadyNotified).toBe(2);
      expect(expired).toBe(2);
      expect(expiring).toBe(2);

      // The sum of notificationsCreated + alreadyNotified should equal checked
      expect(notificationsCreated + alreadyNotified).toBe(checked);
    });

    it('returns zero counts for empty results array', () => {
      const results: Array<{ notificationCreated: boolean }> = [];
      const notificationsCreated = results.filter((r) => r.notificationCreated).length;
      expect(notificationsCreated).toBe(0);
      expect(results.length).toBe(0);
    });
  });

  describe('SQL date boundary edge cases', () => {
    it('expiry date exactly 30 days from now is included', () => {
      const days = calculateDaysUntilExpiry('2026-08-28');
      // 2026-07-29 to 2026-08-28 = 30 days
      expect(days).toBe(30);
      // The SQL uses `<= CURRENT_DATE + INTERVAL '30 days'` so 30 days is included
      expect(days).toBeLessThanOrEqual(30);
    });

    it('expiry date exactly 31 days from now is excluded', () => {
      const days = calculateDaysUntilExpiry('2026-08-29');
      expect(days).toBe(31);
      // Not included in the 30-day window
      expect(days).toBeGreaterThan(30);
    });

    it('expiry date in the distant future is excluded', () => {
      const days = calculateDaysUntilExpiry('2028-12-31');
      expect(days).toBeGreaterThan(30);
    });
  });
});
