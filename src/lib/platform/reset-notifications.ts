import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications, roleAssignments, roles, tenantMemberships } from '@/db/schema';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

export async function notifyPlatformResetRequested(input: {
  requestId: string;
  tenantName: string;
  tenantCode: string;
  reason: string;
}) {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ userId: tenantMemberships.userId, tenantId: tenantMemberships.tenantId })
    .from(tenantMemberships)
    .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(
      and(
        eq(tenantMemberships.status, 'active'),
        inArray(roles.name, [SystemRoles.PLATFORM_ADMIN]),
        lte(roleAssignments.startDate, now),
        or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
      ),
    );

  const recipients = Array.from(
    new Map(rows.map((row) => [`${row.userId}:${row.tenantId}`, row])).values(),
  );
  if (!recipients.length) return;

  await db
    .insert(notifications)
    .values(
      recipients.map((recipient) => ({
        tenantId: recipient.tenantId,
        recipientUserId: recipient.userId,
        audience: 'user',
        type: 'action_required',
        eventType: 'tenant_reset_requested',
        title: `${input.tenantCode} requested an operational reset`,
        body: `${input.tenantName}: ${input.reason}`,
        entityType: 'reset_request',
        entityId: input.requestId,
        actionUrl: `/dashboard/platform/reset?request=${input.requestId}`,
        workspace: WorkspaceIds.PLATFORM_ADMIN,
        requiredRole: SystemRoles.PLATFORM_ADMIN,
        status: 'action_required',
        mandatory: true,
        priority: 'high',
        dedupeKey: `tenant_reset_requested:${input.requestId}:${recipient.userId}:${recipient.tenantId}`,
      })),
    )
    .onConflictDoNothing();
}

export async function resolvePlatformResetRequestNotification(requestId: string) {
  const db = getDb();
  await db
    .update(notifications)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      isRead: true,
      readAt: new Date(),
    })
    .where(
      and(
        eq(notifications.entityType, 'reset_request'),
        eq(notifications.entityId, requestId),
        eq(notifications.eventType, 'tenant_reset_requested'),
      ),
    );
}

export async function notifyResetRequesterOutcome(input: {
  requestId: string;
  tenantId: string;
  requesterUserId: string;
  status: 'approved' | 'in_progress' | 'rejected' | 'completed' | 'failed';
  notes?: string | null;
}) {
  const labels = {
    approved: {
      title: 'Your reset request was approved',
      body:
        'Open Data Reset to review the approved scope. Operational and selective resets become executable by Tenant Administration once the recovery point is verified; protected clean slate remains Platform-executed.',
      type: 'action_required',
      priority: 'high',
    },
    in_progress: {
      title: 'Your approved reset is now in progress',
      body: 'The verified reset plan is being executed. Avoid creating new records until completion.',
      type: 'awareness',
      priority: 'high',
    },
    rejected: {
      title: 'Your reset request was declined',
      body:
        input.notes ||
        'Review the Platform Administrator response and submit a new request if needed.',
      type: 'outcome',
      priority: 'normal',
    },
    completed: {
      title: 'Your approved reset is complete',
      body:
        'The approved reset scope completed successfully and post-reset integrity checks passed. Protected audit and reset history remain available.',
      type: 'outcome',
      priority: 'high',
    },
    failed: {
      title: 'Your reset needs attention',
      body:
        input.notes ||
        'The reset did not complete. The verified recovery point remains available to Platform Administration.',
      type: 'outcome',
      priority: 'high',
    },
  } as const;
  const message = labels[input.status];
  const db = getDb();
  await db
    .insert(notifications)
    .values({
      tenantId: input.tenantId,
      recipientUserId: input.requesterUserId,
      audience: 'user',
      type: message.type,
      eventType: `tenant_reset_${input.status}`,
      title: message.title,
      body: message.body,
      entityType: 'reset_request',
      entityId: input.requestId,
      actionUrl: `/dashboard/admin/data-reset?request=${input.requestId}`,
      workspace: WorkspaceIds.TENANT_ADMIN,
      status: input.status === 'approved' ? 'action_required' : 'unread',
      priority: message.priority,
      dedupeKey: `tenant_reset_${input.status}:${input.requestId}:${input.requesterUserId}`,
    })
    .onConflictDoNothing();
}
