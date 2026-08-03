/**
 * Driver Licence Expiry Digest — daily Transport Administrator sweep.
 *
 * Extracted from the Inngest cron handler (`src/lib/inngest/functions.ts`)
 * into its own module so the logic can be exercised directly by integration
 * tests and any future re-scheduling. The cron wrapper remains a thin call
 * site.
 *
 * Behaviour (spec: PHASE 4.6 / 5.7 — expiry alerts / background jobs):
 *   - One tenant-scoped digest notification per tenant per business day,
 *     idempotent via a day-epoch `eventVersion` key.
 *   - Lists every driver licence that is already expired OR expires within the
 *     next 60 days, excluding archived employees.
 *   - Delivered to every active Transport Administrator (in-app + email).
 */

import { getDb } from '@/db';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';

export interface DriverLicenceExpiryDigestOptions {
  /** Restrict the sweep to these tenants. Defaults to every tenant. */
  tenantIds?: readonly string[];
  /** Override "now" for deterministic tests. Defaults to the current time. */
  now?: Date;
  /** Skip outbound email entirely (integration tests / dry runs). */
  skipEmails?: boolean;
}

export type DriverLicenceExpiryDigestResult = {
  sent: boolean;
  tenantCount: number;
  emailedCount: number;
  skipped?: string;
};

export async function runDriverLicenceExpiryDigest(
  options: DriverLicenceExpiryDigestOptions = {},
): Promise<DriverLicenceExpiryDigestResult> {
  const db = getDb();
  const { driverProfiles, driverLicences, employees } = await import('@/db/schema/people');
  const { tenants } = await import('@/db/schema/tenants');
  const { user } = await import('@/db/schema/better-auth');
  const { notifications } = await import('@/db/schema/notifications');
  const { and, eq, inArray, lte, ne } = await import('drizzle-orm');
  const { isBusinessDay } = await import('@/lib/business-day');

  const today = options.now ? new Date(options.now) : new Date();
  const sixtyDays = new Date(today);
  sixtyDays.setDate(sixtyDays.getDate() + 60);
  const horizon = sixtyDays.toISOString().split('T')[0];

  // Day-epoch key used for idempotency — one digest per tenant per day.
  const dayEpoch = Math.floor(today.getTime() / 86_400_000);

  let sendEmail:
    | ((data: {
        to: string;
        type: string;
        title: string;
        body: string;
        actionUrl?: string;
        recipientName: string;
      }) => Promise<{ success: boolean }>)
    | null = null;
  if (!options.skipEmails) {
    const [emailModule] = await Promise.all([import('@/lib/email')]);
    sendEmail = emailModule.sendNotificationEmail;
  }

  const tenantRows = options.tenantIds?.length
    ? [...options.tenantIds].map((id) => ({ id }))
    : await db.select({ id: tenants.id }).from(tenants).catch(() => []);

  if (tenantRows.length === 0) {
    return { skipped: 'No tenants found', sent: false, tenantCount: 0, emailedCount: 0 };
  }

  let tenantCount = 0;
  let emailedCount = 0;

  for (const tenant of tenantRows) {
    // Skip non-business days for this tenant.
    if (!(await isBusinessDay(tenant.id, today))) continue;

    // Idempotency: a digest for this tenant was already sent today.
    const [alreadySent] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenant.id),
          eq(notifications.eventType, 'driver_licence_expiry_digest'),
          eq(notifications.eventVersion, dayEpoch),
        ),
      )
      .limit(1);
    if (alreadySent) continue;

    // Drivers with a licence that has already expired OR expires within the
    // next 60 days, excluding archived employees.
    const expiring = await db
      .select({
        licenceId: driverLicences.id,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(
        and(
          eq(employees.tenantId, tenant.id),
          ne(employees.employmentStatus, 'archived'),
          lte(driverLicences.expiryDate, horizon),
        ),
      );

    if (expiring.length === 0) continue;

    const recipients = await resolveActiveRoleRecipients(tenant.id, [
      SystemRoles.TRANSPORT_ADMIN,
    ]);
    if (recipients.length === 0) continue;

    const hasUrgent = expiring.some((licence) => {
      const daysLeft = Math.ceil(
        (new Date(licence.expiryDate).getTime() - today.getTime()) / 86_400_000,
      );
      return daysLeft <= 7;
    });

    const lines = expiring
      .map((licence) => {
        const daysLeft = Math.ceil(
          (new Date(licence.expiryDate).getTime() - today.getTime()) / 86_400_000,
        );
        const when =
          daysLeft < 0
            ? `expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
            : daysLeft === 0
              ? 'expires today'
              : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        return `• ${licence.firstName} ${licence.lastName} — ${licence.licenceClass} (${licence.licenceNumber ?? 'no number'}) ${when} (${licence.expiryDate})`;
      })
      .join('\n');

    await createScopedNotifications({
      tenantId: tenant.id,
      recipientUserIds: recipients,
      category: 'reminder',
      eventType: 'driver_licence_expiry_digest',
      title: `🚗 Driver Licence Digest — ${expiring.length} expiring`,
      body: `${expiring.length} driver licence(s) expire within 60 days (or are already expired):\n\n${lines}`,
      entityType: 'driver_licence',
      actionUrl: '/dashboard/drivers',
      workspace: WorkspaceIds.TRANSPORT_ADMIN,
      eventVersion: dayEpoch,
      priority: hasUrgent ? 'high' : 'normal',
    });
    tenantCount += 1;

    if (!sendEmail) continue;

    // Email each Transport Administrator with the same digest body.
    const adminUsers = await db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(user)
      .where(inArray(user.id, recipients));

    for (const admin of adminUsers) {
      if (!admin.email) continue;
      try {
        await sendEmail({
          to: admin.email,
          type: 'reminder',
          title: `Driver Licence Expiry Digest — ${expiring.length} licence(s)`,
          body: `${expiring.length} driver licence(s) expire within 60 days (or are already expired):\n\n${lines}\n\nReview the driver roster for details.`,
          actionUrl: '/dashboard/drivers',
          recipientName: admin.name || 'Transport Administrator',
        });
        emailedCount += 1;
      } catch (emailErr) {
        console.warn(`[driverLicenceExpiryDigest] Email to ${admin.email} failed:`, emailErr);
      }
    }
  }

  return {
    sent: tenantCount > 0,
    tenantCount,
    emailedCount,
  };
}
