import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications } from '@/db/schema/notifications';
import { roleAssignments, roles, tenantMemberships } from '@/db/schema/tenants';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

interface PlatformIntakeNotificationInput {
  entityId: string;
  entityType: 'demo_request' | 'public_enquiry';
  eventType: 'public_demo_request_submitted' | 'public_enquiry_submitted';
  title: string;
  body: string;
  actionUrl: string;
  priority?: 'normal' | 'high';
}

/**
 * Notify active Platform Administrators about unauthenticated public-site intake.
 *
 * A platform operator may have more than one membership. Notifications are
 * therefore written once per active platform membership instead of deduping by
 * user alone. The notification feed remains tenant-bound, so whichever platform
 * membership is active in the session receives the unread bell count correctly.
 */
export async function notifyPlatformIntake(input: PlatformIntakeNotificationInput) {
  const db = getDb();
  const now = new Date();

  const recipients = await db
    .select({
      userId: tenantMemberships.userId,
      tenantId: tenantMemberships.tenantId,
    })
    .from(tenantMemberships)
    .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(
      and(
        eq(tenantMemberships.status, 'active'),
        inArray(roles.name, [SystemRoles.PLATFORM_ADMIN, SystemRoles.PLATFORM_SUPPORT]),
        or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
      ),
    );

  const uniqueRecipients = Array.from(
    new Map(
      recipients.map((recipient) => [`${recipient.userId}:${recipient.tenantId}`, recipient]),
    ).values(),
  );

  if (uniqueRecipients.length === 0) return;

  await db
    .insert(notifications)
    .values(
      uniqueRecipients.map((recipient) => ({
        tenantId: recipient.tenantId,
        recipientUserId: recipient.userId,
        audience: 'user',
        type: 'action_required',
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        actionUrl: input.actionUrl,
        workspace: WorkspaceIds.PLATFORM_ADMIN,
        status: 'unread',
        isRead: false,
        priority: input.priority ?? 'normal',
        dedupeKey: `${input.eventType}:${input.entityId}:${recipient.userId}:${recipient.tenantId}`,
      })),
    )
    // The database enforces dedupe_key through a partial unique index
    // (WHERE dedupe_key IS NOT NULL). PostgreSQL cannot infer that partial
    // index from ON CONFLICT (dedupe_key) unless the same predicate is supplied,
    // so use target-less DO NOTHING and let PostgreSQL resolve the applicable
    // unique constraint/index safely.
    .onConflictDoNothing();
}
