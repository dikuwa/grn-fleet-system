import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications } from '@/db/schema/notifications';
import { roleAssignments, roles, tenantMemberships } from '@/db/schema/tenants';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

const INTAKE_ROLE_NAMES = [SystemRoles.PLATFORM_ADMIN, SystemRoles.PLATFORM_SUPPORT] as const;

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
 * Notify active Platform Admin / Platform Support users about unauthenticated
 * public-site intake. Notifications are written against each recipient's own
 * platform membership tenant, keeping the existing notification tenant boundary
 * intact rather than inventing a global/null tenant notification.
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
        inArray(roles.name, [...INTAKE_ROLE_NAMES]),
        or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
      ),
    );

  const uniqueRecipients = Array.from(
    new Map(recipients.map((recipient) => [recipient.userId, recipient])).values(),
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
        priority: input.priority ?? 'normal',
        dedupeKey: `${input.eventType}:${input.entityId}:${recipient.userId}`,
      })),
    )
    .onConflictDoNothing({ target: notifications.dedupeKey });
}
