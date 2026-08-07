/**
 * Subscription Lifecycle Inngest Function
 *
 * Daily cron that evaluates every transitional subscription and applies the
 * lifecycle transitions (trial → active → grace_period → expired). Sends a
 * notification + email to tenant/platform admins when the status changes.
 *
 * Note: usage-enforcement (restrict at 100%, warn at 80%) lives in
 * `usage-enforcement.ts`; the expiry digests already live in
 * `src/lib/inngest/functions.ts`.
 */

import { inngest } from '@/lib/inngest/client';
import { getDb } from '@/db';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { inArray } from 'drizzle-orm';
import { evaluateSubscriptionLifecycle, getTenantSubscription } from '@/lib/platform/subscriptions';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

type SubscriptionStatus = NonNullable<Awaited<ReturnType<typeof getTenantSubscription>>>['status'];

const TRANSITIONAL_STATES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'pending_payment',
  'past_due',
  'grace_period',
  'restricted',
];

const NOTIFICATION_META: Record<string, { eventType: string; title: string; body: string; priority: 'normal' | 'high' }> = {
  active: {
    eventType: 'subscription_activated',
    title: '✅ Subscription Activated',
    body: 'Your subscription is now active.',
    priority: 'normal',
  },
  past_due: {
    eventType: 'subscription_past_due',
    title: '⚠️ Subscription Past Due',
    body: 'Your subscription payment is overdue. Please submit payment to avoid service interruption.',
    priority: 'high',
  },
  grace_period: {
    eventType: 'subscription_grace_period',
    title: '⏳ Subscription in Grace Period',
    body: 'Your subscription has entered its grace period. Payment must be received before it ends.',
    priority: 'high',
  },
  expired: {
    eventType: 'subscription_expired',
    title: '❌ Subscription Expired',
    body: 'Your subscription has expired. Access to the platform is now restricted.',
    priority: 'high',
  },
  restricted: {
    eventType: 'subscription_restricted',
    title: '🔒 Subscription Restricted',
    body: 'Your subscription has been restricted due to usage over limits. Please upgrade your plan or reduce usage.',
    priority: 'high',
  },
};

// ---------------------------------------------------------------------------
// Helper: Send lifecycle notification to tenant admins
// ---------------------------------------------------------------------------

async function sendLifecycleNotification(
  tenantId: string,
  eventType: string,
  title: string,
  body: string,
  priority: 'normal' | 'high',
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
}

// ---------------------------------------------------------------------------
// Subscription Lifecycle Evaluation Cron
// ---------------------------------------------------------------------------

export const subscriptionLifecycleEvaluation = inngest
  ? inngest.createFunction(
      { id: 'subscription-lifecycle-evaluation', retries: 2 },
      { cron: '0 2 * * *' }, // Daily at 02:00 UTC
      async ({ step }) => {
        return step.run('Evaluate subscription lifecycle for all tenants', async () => {
          const db = getDb();

          const subscriptionRows = await db
            .select({
              tenantId: tenantSubscriptions.tenantId,
              status: tenantSubscriptions.status,
            })
            .from(tenantSubscriptions)
            .where(inArray(tenantSubscriptions.status, [...TRANSITIONAL_STATES]));

          let evaluated = 0;
          let transitions = 0;
          let notificationsSent = 0;

          for (const row of subscriptionRows) {
            evaluated++;
            const previousStatus = row.status;
            const newStatus = await evaluateSubscriptionLifecycle(row.tenantId);
            if (!newStatus || newStatus === previousStatus) continue;

            transitions++;
            const meta = NOTIFICATION_META[newStatus];
            if (meta) {
              await sendLifecycleNotification(
                row.tenantId,
                meta.eventType,
                meta.title,
                meta.body,
                meta.priority,
              );
              notificationsSent++;
            }
          }

          return { evaluated, transitions, notificationsSent };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export const subscriptionLifecycleFunctions = (
  [subscriptionLifecycleEvaluation] as const
).filter((f): f is NonNullable<typeof f> => f !== null);