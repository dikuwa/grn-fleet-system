/**
 * Driver Licence Expiry Digest — Integration Tests
 *
 * Exercises the extracted background-job core (`runDriverLicenceExpiryDigest`)
 * against the seeded database, exactly as the Inngest cron would on its daily
 * schedule:
 *
 *   1. On a business day, one tenant-scoped digest notification is created for
 *      the tenant listing driver licences that expire within 60 days, sent to
 *      every active Transport Administrator.
 *   2. The digest is idempotent per tenant per day — re-running the job does
 *      not create a second notification.
 *   3. Already-expired licences are included (spec: "expire within the next
 *      60 days (or are already expired)").
 *   4. Tenants without expiring licences / Transport Administrators receive no
 *      digest, and digests never leak across tenants.
 *
 * Run with: `pnpm test:integration` (requires the seeded dev server on
 * http://localhost:3000 and .env.test with DB credentials).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const TENANT_A = '00000000-0000-0000-0000-000000000001'; // Kavango East (seeded)
const TENANT_B = '00000000-0000-0000-0000-000000000002'; // isolation tenant

describe('Driver licence expiry digest (background job core)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    db = (await import('@/db')).getDb();
  });

  /** Remove any digest notifications for (tenant, day-epoch) so runs are deterministic. */
  async function cleanDigests(tenantId: string, dayEpoch: number) {
    const { notifications } = await import('@/db/schema/notifications');
    const { and, eq } = await import('drizzle-orm');
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.eventType, 'driver_licence_expiry_digest'),
          eq(notifications.eventVersion, dayEpoch),
        ),
      );
  }

  /** Create an active employee + driver profile + licence (cascade-cleaned). */
  async function createDriverFixture(tenantId: string, tag: string, expiryDate: string) {
    const { employees, driverProfiles, driverLicences } = await import('@/db/schema/people');
    const issueDate = new Date(Date.now() - 365 * 86_400_000).toISOString().split('T')[0];
    const unique = `${tag}-${Date.now()}`;

    const [emp] = await db
      .insert(employees)
      .values({
        tenantId,
        employeeNumber: unique,
        firstName: 'Digest',
        lastName: tag,
        email: `${unique}@kavangoeast.test`,
        employmentStatus: 'active',
      })
      .returning({ id: employees.id });

    const [profile] = await db
      .insert(driverProfiles)
      .values({ employeeId: emp.id })
      .returning({ id: driverProfiles.id });

    const [licence] = await db
      .insert(driverLicences)
      .values({
        driverProfileId: profile.id,
        licenceNumber: `DL-${unique}`,
        licenceClass: 'EB',
        issueDate,
        expiryDate,
        holderName: `Digest ${tag}`,
      })
      .returning({ id: driverLicences.id });

    return { employeeId: emp.id, profileId: profile.id, licenceId: licence.id };
  }

  /** Delete the employee — driver profile + licences cascade. */
  async function removeDriverFixture(employeeId: string) {
    const { employees } = await import('@/db/schema/people');
    const { eq } = await import('drizzle-orm');
    await db.delete(employees).where(eq(employees.id, employeeId));
  }

  /** Deterministic "now": the next business day for the tenant at 08:00 local. */
  async function nextBusinessMorning(tenantId: string): Promise<Date> {
    const { nextBusinessDay } = await import('@/lib/business-day');
    const now = await nextBusinessDay(tenantId, new Date());
    now.setHours(8, 0, 0, 0);
    return now;
  }

  async function digestRows(tenantId: string, dayEpoch: number) {
    const { notifications } = await import('@/db/schema/notifications');
    const { and, eq } = await import('drizzle-orm');
    return db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.eventType, 'driver_licence_expiry_digest'),
          eq(notifications.eventVersion, dayEpoch),
        ),
      );
  }

  it('creates one tenant-scoped digest per business day and is idempotent on re-run', async () => {
    const { runDriverLicenceExpiryDigest } = await import('@/lib/inngest/expiry-digest');
    const { resolveActiveRoleRecipients } = await import('@/lib/notification-service');
    const { SystemRoles } = await import('@/lib/workspaces');

    const now = await nextBusinessMorning(TENANT_A);
    const dayEpoch = Math.floor(now.getTime() / 86_400_000);
    const expiry = new Date(now.getTime() + 20 * 86_400_000).toISOString().split('T')[0];
    const { employeeId } = await createDriverFixture(TENANT_A, 'soon', expiry);
    await cleanDigests(TENANT_A, dayEpoch);

    try {
      const recipients = await resolveActiveRoleRecipients(TENANT_A, [
        SystemRoles.TRANSPORT_ADMIN,
      ]);
      expect(
        recipients.length,
        'seeded tenant must expose at least one active Transport Administrator',
      ).toBeGreaterThan(0);

      // ── First run creates the digest for the tenant ──
      const result = await runDriverLicenceExpiryDigest({
        tenantIds: [TENANT_A],
        now,
        skipEmails: true,
      });
      expect(result.sent).toBe(true);
      expect(result.tenantCount).toBe(1);
      expect(result.emailedCount).toBe(0); // skipEmails

      const rows = await digestRows(TENANT_A, dayEpoch);
      expect(rows).toHaveLength(recipients.length);
      expect(rows[0].recipientUserId).toBe(recipients[0]);
      expect(rows[0].actionUrl).toBe('/dashboard/drivers');
      expect(rows[0].workspace).toBe('transport_admin');
      expect(rows[0].body).toContain('soon'); // the fixture driver's last name
      expect(rows[0].body).toContain('expires in 20 days');
      expect(rows[0].eventVersion).toBe(dayEpoch);

      // ── Re-running on the same day is a no-op (idempotency) ──
      const second = await runDriverLicenceExpiryDigest({
        tenantIds: [TENANT_A],
        now,
        skipEmails: true,
      });
      expect(second.sent).toBe(false);
      expect(second.tenantCount).toBe(0);

      const rowsAfter = await digestRows(TENANT_A, dayEpoch);
      expect(rowsAfter).toHaveLength(recipients.length);
    } finally {
      await cleanDigests(TENANT_A, dayEpoch);
      await removeDriverFixture(employeeId);
    }
  });

  it('includes already-expired licences in the digest', async () => {
    const { runDriverLicenceExpiryDigest } = await import('@/lib/inngest/expiry-digest');

    const now = await nextBusinessMorning(TENANT_A);
    const dayEpoch = Math.floor(now.getTime() / 86_400_000);
    const expiredDate = new Date(now.getTime() - 5 * 86_400_000).toISOString().split('T')[0];
    const { employeeId } = await createDriverFixture(TENANT_A, 'lapsed', expiredDate);
    await cleanDigests(TENANT_A, dayEpoch);

    try {
      const result = await runDriverLicenceExpiryDigest({
        tenantIds: [TENANT_A],
        now,
        skipEmails: true,
      });
      expect(result.sent).toBe(true);

      const rows = await digestRows(TENANT_A, dayEpoch);
      expect(rows.length).toBeGreaterThan(0);
      const row = rows.find((r: { body: string | null }) => r.body?.includes('lapsed'));
      expect(row, 'digest body should list the expired licence').toBeTruthy();
      expect(row.body).toContain('expired 5 days ago');
    } finally {
      await cleanDigests(TENANT_A, dayEpoch);
      await removeDriverFixture(employeeId);
    }
  });

  it('sends nothing to tenants without expiring licences or admins (no cross-tenant leak)', async () => {
    const { runDriverLicenceExpiryDigest } = await import('@/lib/inngest/expiry-digest');

    const now = await nextBusinessMorning(TENANT_B);
    const dayEpoch = Math.floor(now.getTime() / 86_400_000);
    await cleanDigests(TENANT_B, dayEpoch);

    const result = await runDriverLicenceExpiryDigest({
      tenantIds: [TENANT_B],
      now,
      skipEmails: true,
    });
    expect(result.sent).toBe(false);

    const rows = await digestRows(TENANT_B, dayEpoch);
    expect(rows).toHaveLength(0);
  });
});
