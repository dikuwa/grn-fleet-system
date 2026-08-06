import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  notifications,
  roleAssignments,
  rolePermissions,
  roles,
  tenantMemberships,
} from '@/db/schema';
import type { WorkspaceId } from '@/lib/workspaces';

export type NotificationCategory =
  'action_required' | 'reminder' | 'outcome' | 'escalation' | 'awareness';

export type NotificationRecipientContext = {
  ownerUserId?: string | null;
  requesterUserId?: string | null;
  participantUserIds?: readonly string[];
  assignedUserIds?: readonly string[];
  currentApproverUserId?: string | null;
  escalationUserIds?: readonly string[];
  administrativeUserIds?: readonly string[];
};

export function resolveRecipientIds(context: NotificationRecipientContext) {
  return Array.from(
    new Set(
      [
        context.ownerUserId,
        context.requesterUserId,
        ...(context.participantUserIds ?? []),
        ...(context.assignedUserIds ?? []),
        context.currentApproverUserId,
        ...(context.escalationUserIds ?? []),
        ...(context.administrativeUserIds ?? []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

export function buildNotificationDedupeKey(input: {
  recipientUserId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  workflowStage?: string | null;
  eventVersion?: number;
}) {
  return [
    input.recipientUserId,
    input.eventType,
    input.entityType ?? 'none',
    input.entityId ?? 'none',
    input.workflowStage ?? 'none',
    input.eventVersion ?? 1,
  ].join(':');
}

/**
 * Resolve every active user in a tenant whose current role assignments grant
 * the given permission code.
 *
 * Mirrors the role-assignment join in `getSessionPermissions` (role
 * assignment → role_permissions join, active membership, start/end date
 * window) but tenant-wide rather than for a single session. Note it does not
 * apply the session-level workspace filter — reminders intentionally reach
 * every active holder of the permission, not only users whose currently
 * active workspace surfaces the step. Used to fan out workflow
 * reminders/escalations to every user who can act on a permission-routed
 * (unassigned) step.
 */
export async function resolvePermissionRecipients(
  tenantId: string,
  permissionCode: string,
): Promise<string[]> {
  const now = new Date();
  const db = getDb();
  const rows = await db
    .select({
      userId: tenantMemberships.userId,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
    })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        eq(rolePermissions.permissionCode, permissionCode),
      ),
    );

  return Array.from(
    new Set(
      rows
        .filter((row) => row.startDate <= now && (!row.endDate || row.endDate >= now))
        .map((row) => row.userId),
    ),
  );
}

export async function resolveActiveRoleRecipients(tenantId: string, roleNames: readonly string[]) {
  if (!roleNames.length) return [];
  const now = new Date();
  const db = getDb();
  const rows = await db
    .select({
      userId: tenantMemberships.userId,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
    })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        inArray(roles.name, [...roleNames]),
      ),
    );
  return Array.from(
    new Set(
      rows
        .filter((row) => row.startDate <= now && (!row.endDate || row.endDate >= now))
        .map((row) => row.userId),
    ),
  );
}

export async function createScopedNotifications(input: {
  tenantId: string;
  recipientUserIds: readonly string[];
  category: NotificationCategory;
  eventType: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  workspace?: WorkspaceId | null;
  workflowStage?: string | null;
  eventVersion?: number;
  priority?: string;
  mandatory?: boolean;
  requiredRole?: string | null;
}) {
  const recipients = Array.from(new Set(input.recipientUserIds.filter(Boolean)));
  if (!recipients.length) return [];
  const db = getDb();
  return db
    .insert(notifications)
    .values(
      recipients.map((recipientUserId) => ({
        tenantId: input.tenantId,
        recipientUserId,
        audience: 'user',
        type: input.category,
        eventType: input.eventType,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
        requiredRole: input.requiredRole ?? null,
        workspace: input.workspace ?? null,
        workflowStage: input.workflowStage ?? null,
        eventVersion: input.eventVersion ?? 1,
        dedupeKey: buildNotificationDedupeKey({
          recipientUserId,
          eventType: input.eventType,
          entityType: input.entityType,
          entityId: input.entityId,
          workflowStage: input.workflowStage,
          eventVersion: input.eventVersion,
        }),
        status: input.category === 'action_required' ? 'action_required' : 'unread',
        mandatory: input.mandatory ?? input.category === 'action_required',
        priority: input.priority ?? 'normal',
      })),
    )
    .onConflictDoNothing()
    .returning();
}

export async function resolveActionNotifications(input: {
  tenantId: string;
  entityType: string;
  entityId: string;
  eventTypes?: readonly string[];
}) {
  const db = getDb();
  const conditions = [
    eq(notifications.tenantId, input.tenantId),
    eq(notifications.entityType, input.entityType),
    eq(notifications.entityId, input.entityId),
    eq(notifications.status, 'action_required'),
  ];
  if (input.eventTypes?.length)
    conditions.push(inArray(notifications.eventType, [...input.eventTypes]));
  return db
    .update(notifications)
    .set({ status: 'resolved', resolvedAt: new Date(), isRead: true, readAt: new Date() })
    .where(and(...conditions));
}
