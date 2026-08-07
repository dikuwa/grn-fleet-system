/**
 * Usage Enforcement Inngest Function
 *
 * Runs weekly to check usage against entitlement limits and:
 * - Send warnings at 80% of limits
 * - Block/restrict at 100% of limits
 */

import { inngest } from '@/lib/inngest/client';
import { getDb } from '@/db';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema/tenants';
import { eq, and, isNotNull, or } from 'drizzle-orm';
import { refreshUsageCounters } from '@/lib/platform/subscriptions';
import { transitionSubscription } from '@/lib/platform/subscriptions';
import { createScopedNotifications } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { resolveActiveRoleRecipients } from '@/lib/notification-service';
import { sendNotificationEmail } from '@/lib/email';

// ---------------------------------------------------------------------------
// Helper: Send usage notification
// ---------------------------------------------------------------------------

async function sendUsageNotification(
  tenantId: string,
  eventType: string,
  title: string,
  body: string,
  priority: 'normal' | 'high' = 'normal',
): Promise<void> {
  const recipients = await resolveActiveRoleRecipients(tenantId, [
    SystemRoles.TENANT_ADMIN,
    SystemRoles.TRANSPORT_ADMIN,
  ]);

  if (recipients.length === 0) return;

  await createScopedNotifications({
    tenantId,
    recipientUserIds: recipients,
    category: 'awareness',
    eventType,
    title,
    body,
    entityType: 'subscription',
    actionUrl: '/dashboard/settings/billing',
    workspace: WorkspaceIds.TENANT_ADMIN,
    priority,
  });

  // Email admins
  const { user } = await import('@/db/schema/better-auth');
  const { inArray } = await import('drizzle-orm');
  const db = getDb();

  const admins = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, recipients));

  for (const admin of admins) {
    if (!admin.email) continue;
    try {
      await sendNotificationEmail({
        to: admin.email,
        type: 'system',
        title,
        body,
        actionUrl: '/dashboard/settings/billing',
        recipientName: admin.name || 'Administrator',
      });
    } catch (err) {
      console.warn(`[usage-enforcement] Email to ${admin.email} failed:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Usage Enforcement Cron
// ---------------------------------------------------------------------------
//
// Runs weekly to check usage against entitlement limits

export const usageEnforcement = inngest
  ? inngest.createFunction(
      { id: 'usage-enforcement', retries: 2 },
      { cron: '0 3 * * 1' }, // Weekly on Monday at 03:00 UTC
      async ({ step }) => {
        return step.run('Enforce usage limits for all tenants', async () => {
          const db = getDb();

          // Get all active subscriptions with their package limits
          const subscriptions = await db
            .select({
              tenantId: tenantSubscriptions.tenantId,
              subscriptionId: tenantSubscriptions.id,
              status: tenantSubscriptions.status,
              currentVehicles: tenantSubscriptions.currentVehicles,
              currentUsers: tenantSubscriptions.currentUsers,
              currentDrivers: tenantSubscriptions.currentDrivers,
              currentDepartments: tenantSubscriptions.currentDepartments,
              currentOffices: tenantSubscriptions.currentOffices,
              currentStorageGb: tenantSubscriptions.currentStorageGb,
              vehicleLimit: tenants.vehicleLimit,
              userLimit: tenants.userLimit,
              storageLimit: tenants.storageLimit,
            })
            .from(tenantSubscriptions)
            .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
            .where(
              and(
                eq(tenantSubscriptions.status, 'active'),
                // Only enforce on tenants with at least one limit set
                or(
                  isNotNull(tenants.vehicleLimit),
                  isNotNull(tenants.userLimit),
                  isNotNull(tenants.storageLimit),
                ),
              ),
            );

          let checked = 0;
          let warnings = 0;
          let restrictions = 0;
          let notificationsSent = 0;

          for (const sub of subscriptions) {
            checked++;

            // Refresh counters first
            await refreshUsageCounters(sub.tenantId);

            // Re-fetch updated counts
            const [updated] = await db
              .select({
                currentVehicles: tenantSubscriptions.currentVehicles,
                currentUsers: tenantSubscriptions.currentUsers,
                currentDrivers: tenantSubscriptions.currentDrivers,
                currentDepartments: tenantSubscriptions.currentDepartments,
                currentOffices: tenantSubscriptions.currentOffices,
                currentStorageGb: tenantSubscriptions.currentStorageGb,
              })
              .from(tenantSubscriptions)
              .where(eq(tenantSubscriptions.id, sub.subscriptionId))
              .limit(1);

            if (!updated) continue;

            const limits = {
              vehicles: sub.vehicleLimit ?? Infinity,
              users: sub.userLimit ?? Infinity,
              drivers: Infinity, // No explicit driver limit in schema yet
              departments: Infinity,
              offices: Infinity,
              storageGb: sub.storageLimit ?? Infinity,
            };

            const usage = {
              vehicles: updated.currentVehicles,
              users: updated.currentUsers,
              drivers: updated.currentDrivers,
              departments: updated.currentDepartments,
              offices: updated.currentOffices,
              storageGb: updated.currentStorageGb,
            };

            // Check each limit
            for (const [metric, limit] of Object.entries(limits)) {
              if (!isFinite(limit)) continue;

              const used = usage[metric as keyof typeof usage];
              const percentage = (used / limit) * 100;

              // 100%+ → Restrict
              if (percentage >= 100) {
                if (sub.status === 'active') {
                  await transitionSubscription(sub.subscriptionId, 'restricted', {
                    tenantId: sub.tenantId,
                    reason: `Usage limit exceeded: ${metric} at ${used}/${limit} (${percentage.toFixed(0)}%)`,
                  });

                  await sendUsageNotification(
                    sub.tenantId,
                    'usage_limit_exceeded',
                    `🔒 Usage Limit Exceeded — ${metric}`,
                    `Your subscription has been restricted because ${metric} usage (${used}/${limit}) exceeded the plan limit. Please upgrade your plan or reduce usage.`,
                    'high',
                  );
                  restrictions++;
                  notificationsSent++;
                }
                break; // Stop checking other limits once restricted
              }

              // 80-99% → Warning
              if (percentage >= 80) {
                await sendUsageNotification(
                  sub.tenantId,
                  'usage_warning',
                  `⚠️ Usage Warning — ${metric} at ${percentage.toFixed(0)}%`,
                  `Your ${metric} usage is at ${used}/${limit} (${percentage.toFixed(0)}% of limit). Consider upgrading your plan if growth continues.`,
                  'normal',
                );
                warnings++;
                notificationsSent++;
              }
            }
          }

          return {
            checked,
            warnings,
            restrictions,
            notificationsSent,
          };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export const usageEnforcementInngestFunctions = (
  [usageEnforcement] as const
).filter((f): f is NonNullable<typeof f> => f !== null);