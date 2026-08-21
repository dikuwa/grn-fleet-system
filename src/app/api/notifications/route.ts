import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  notifications,
  notificationPreferences,
  notificationDeliveries,
  notificationReads,
  notificationDismissals,
} from '@/db/schema/notifications';
import { eq, and, desc, or, ne, inArray, isNull } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { requirePermission } from '@/lib/auth-helpers';
import { getSessionRoleNames, getSessionWorkspace } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tenantMemberships } from '@/db/schema/tenants';
import { sendNotificationEmail } from '@/lib/email';
import { sendNotificationSms, isSmsEnabled } from '@/lib/sms';
import { canAccessDashboardPath, SystemRoles } from '@/lib/dashboard-access';
import { employees } from '@/db/schema/people';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Require auth — only return notifications for the authenticated user/tenant
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const userId = session.user.id;
    const tenantId = session.tenantId;

    const type = searchParams.get('type');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = getDb();

    const workspaceContext = await getSessionWorkspace(session);
    const { roleNames, activeWorkspace } = workspaceContext;
    const isPlatformAdministrator = roleNames.includes(SystemRoles.PLATFORM_ADMIN);
    const [employee] = await db
      .select({
        departmentId: employees.departmentId,
        officeId: employees.officeId,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
      .limit(1);
    const scopedAudiences = [
      ...(roleNames.includes(SystemRoles.TENANT_ADMIN)
        ? [eq(notifications.audience, 'tenant_admin')]
        : []),
      ...(roleNames.length
        ? [
            and(
              eq(notifications.audience, 'role'),
              inArray(notifications.audienceTarget, roleNames),
            )!,
          ]
        : []),
      ...(employee?.departmentId
        ? [
            and(
              eq(notifications.audience, 'department'),
              eq(notifications.audienceTarget, employee.departmentId),
            )!,
          ]
        : []),
      ...(employee?.officeId
        ? [
            and(
              eq(notifications.audience, 'office'),
              eq(notifications.audienceTarget, employee.officeId),
            )!,
          ]
        : []),
    ];
    const audienceCondition = isPlatformAdministrator
      ? or(
          and(eq(notifications.audience, 'user'), eq(notifications.recipientUserId, userId)),
          eq(notifications.audience, 'platform'),
        )
      : or(
          and(eq(notifications.audience, 'user'), eq(notifications.recipientUserId, userId)),
          ...scopedAudiences,
        );
    const conditions = [
      eq(notifications.tenantId, tenantId),
      audienceCondition!,
      ne(notifications.status, 'archived'),
      ne(notifications.status, 'dismissed'),
      or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace))!,
    ];

    if (type && type !== 'all') {
      conditions.push(eq(notifications.type, type));
    }

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    const whereClause = and(...conditions);

    const visibleItems = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(Math.max(limit, 200));
    const sharedIds = visibleItems
      .filter((item) => item.audience !== 'user')
      .map((item) => item.id);
    const readRows = sharedIds.length
      ? await db
          .select({ notificationId: notificationReads.notificationId })
          .from(notificationReads)
          .where(
            and(
              eq(notificationReads.userId, userId),
              inArray(notificationReads.notificationId, sharedIds),
            ),
          )
      : [];
    const readIds = new Set(readRows.map((row) => row.notificationId));
    // Fetch dismissed notification IDs for this user
    const dismissedRows = await db
      .select({ notificationId: notificationDismissals.notificationId })
      .from(notificationDismissals)
      .where(
        and(
          eq(notificationDismissals.userId, userId),
          inArray(
            notificationDismissals.notificationId,
            visibleItems.map((i) => i.id),
          ),
        ),
      );
    const dismissedIds = new Set(dismissedRows.map((row) => row.notificationId));

    // Filter out dismissed notifications
    const undismissedItems = visibleItems.filter((item) => !dismissedIds.has(item.id));

    const normalized = undismissedItems.map((item) => {
      const isRead = item.audience === 'user' ? item.isRead : readIds.has(item.id);
      const actionAllowed = item.actionUrl
        ? canAccessDashboardPath(item.actionUrl, roleNames, activeWorkspace) &&
          (!item.requiredRole || roleNames.includes(item.requiredRole))
        : false;
      return { ...item, isRead, actionUrl: actionAllowed ? item.actionUrl : null };
    });
    const filtered = unreadOnly ? normalized.filter((item) => !item.isRead) : normalized;
    const items = filtered.slice(0, limit);
    const unreadCount = normalized.filter((item) => !item.isRead).length;
    const actionRequiredCount = normalized.filter(
      (item) => item.status === 'action_required',
    ).length;
    const attentionCount = normalized.filter(
      (item) => !item.isRead || item.status === 'action_required',
    ).length;
    const [preferences] = await db
      .select({
        emailNotifications: notificationPreferences.emailNotifications,
        inAppNotifications: notificationPreferences.inAppNotifications,
        quietHoursStart: notificationPreferences.quietHoursStart,
        quietHoursEnd: notificationPreferences.quietHoursEnd,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.tenantId, tenantId),
        ),
      )
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        notifications: items,
        unreadCount,
        actionRequiredCount,
        attentionCount,
        preferences: preferences || {
          emailNotifications: true,
          inAppNotifications: true,
          quietHoursStart: '20:00',
          quietHoursEnd: '07:00',
        },
      },
    });
  } catch (error) {
    console.error('Notifications API failed:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

/**
 * POST /api/notifications
 *
 * Create a notification and deliver via configured channels (in-app + email).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await request.json();
    const {
      tenantId: requestedTenantId,
      recipientUserId,
      recipientEmail,
      recipientName,
      type,
      title,
      body: notificationBody,
      entityType,
      entityId,
      actionUrl,
      priority = 'normal',
      tenantName,
      audience = 'user',
      audienceTarget,
      requiredRole,
    } = body;

    if ((audience === 'user' && !recipientUserId) || !type || !title) {
      return NextResponse.json(
        {
          error: 'Missing required fields: tenantId, recipientUserId, type, title',
        },
        { status: 400 },
      );
    }

    const db = getDb();
    const tenantId = session.tenantId;
    if (requestedTenantId && requestedTenantId !== tenantId)
      return NextResponse.json({ error: 'Cross-tenant notification denied' }, { status: 403 });
    if (!['user', 'platform'].includes(audience)) {
      return NextResponse.json({ error: 'Invalid notification audience' }, { status: 400 });
    }
    if (audience === 'platform') {
      const roleNames = await getSessionRoleNames(session);
      if (!roleNames.includes(SystemRoles.PLATFORM_ADMIN)) {
        return NextResponse.json(
          { error: 'Only Platform Administrators may publish platform events' },
          { status: 403 },
        );
      }
    }
    if (['role', 'department', 'office'].includes(audience) && !audienceTarget) {
      return NextResponse.json(
        { error: 'The selected audience requires a target' },
        { status: 400 },
      );
    }
    if (audience === 'user') {
      const [recipientMembership] = await db
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, recipientUserId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!recipientMembership)
        return NextResponse.json(
          { error: 'Recipient is not an active tenant member' },
          { status: 404 },
        );
    }

    // 1. Create in-app notification
    const [notification] = await db
      .insert(notifications)
      .values({
        tenantId,
        recipientUserId: audience === 'user' ? recipientUserId : null,
        audience,
        audienceTarget: audienceTarget || null,
        type,
        title,
        body: notificationBody || null,
        entityType: entityType || null,
        entityId: entityId || null,
        actionUrl: actionUrl || null,
        priority: priority || 'normal',
        requiredRole: requiredRole || null,
        eventType: body.eventType || type,
        workspace: body.workspace || null,
        workflowStage: body.workflowStage || null,
        eventVersion: Number(body.eventVersion) || 1,
        dedupeKey: body.dedupeKey || null,
        status: type === 'action_required' ? 'action_required' : 'unread',
        mandatory: Boolean(body.mandatory || type === 'action_required'),
      })
      .onConflictDoNothing()
      .returning();

    if (!notification) {
      return NextResponse.json({
        success: true,
        data: { notification: null, deliveries: [], duplicate: true },
      });
    }

    // 2. Check delivery preferences and send email + SMS if configured
    const [prefs] =
      audience === 'user'
        ? await db
            .select()
            .from(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.userId, String(recipientUserId)),
                eq(notificationPreferences.tenantId, tenantId),
              ),
            )
            .limit(1)
        : [];

    const shouldSendEmail =
      audience === 'user' &&
      prefs?.emailNotifications !== false && // default true
      recipientEmail;

    const isHighPriority = priority === 'high' || priority === 'emergency';

    const deliveryRecords: Array<typeof notificationDeliveries.$inferSelect> = [];

    // Email delivery
    if (shouldSendEmail) {
      const emailResult = await sendNotificationEmail({
        to: recipientEmail,
        type,
        title,
        body: notificationBody || title,
        actionUrl,
        recipientName: recipientName || recipientEmail,
        tenantName,
      });

      const [record] = await db
        .insert(notificationDeliveries)
        .values({
          notificationId: notification.id,
          channel: 'email',
          attempt: 1,
          status: emailResult.success ? 'sent' : 'failed',
          errorSummary: emailResult.error || null,
          providerId: emailResult.id || null,
        })
        .returning();
      deliveryRecords.push(record);
    } else {
      const [record] = await db
        .insert(notificationDeliveries)
        .values({
          notificationId: notification.id,
          channel: 'email',
          attempt: 1,
          status: 'skipped',
          errorSummary:
            audience !== 'user'
              ? 'Shared activity events are in-app only'
              : prefs?.emailNotifications === false
                ? 'Email notifications disabled by user preference'
                : recipientEmail
                  ? null
                  : 'No email address available',
        })
        .returning();
      deliveryRecords.push(record);
    }

    // SMS delivery — only for high-priority notifications or if explicitly configured
    const recipientPhone = body.recipientPhone;
    const smsEnabled = isSmsEnabled();
    const shouldSendSms =
      audience === 'user' && smsEnabled && (isHighPriority || body.forceSms) && recipientPhone;

    if (shouldSendSms) {
      const smsResult = await sendNotificationSms(
        recipientPhone,
        title,
        notificationBody || title,
        tenantName,
      );

      const [record] = await db
        .insert(notificationDeliveries)
        .values({
          notificationId: notification.id,
          channel: 'sms',
          attempt: 1,
          status: smsResult.success ? 'sent' : 'failed',
          errorSummary: smsResult.error || null,
          providerId: smsResult.id || null,
        })
        .returning();
      deliveryRecords.push(record);
    } else if (smsEnabled && !recipientPhone) {
      // Record skipped — no phone number
      const [record] = await db
        .insert(notificationDeliveries)
        .values({
          notificationId: notification.id,
          channel: 'sms',
          attempt: 1,
          status: 'skipped',
          errorSummary: 'No phone number available for SMS delivery',
        })
        .returning();
      deliveryRecords.push(record);
    }

    return NextResponse.json({
      success: true,
      data: {
        notification,
        deliveries: deliveryRecords,
      },
    });
  } catch (error) {
    console.error('Notification creation failed:', error);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications
 *
 * Delete or dismiss notifications for the authenticated user.
 * - With ?id=uuid: delete that specific notification (user-scoped) or dismiss it (shared)
 * - Without id: clear all notifications this user is eligible to see
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const userId = session.user.id;
    const tenantId = session.tenantId;
    const { searchParams } = new URL(request.url);
    const notificationId = searchParams.get('id');

    const db = getDb();
    const workspaceContext = await getSessionWorkspace(session);
    const { roleNames, activeWorkspace } = workspaceContext;
    const isPlatformAdministrator = roleNames.includes(SystemRoles.PLATFORM_ADMIN);
    const [employee] = await db
      .select({
        departmentId: employees.departmentId,
        officeId: employees.officeId,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
      .limit(1);
    // Same audience scoping as GET — only notifications this user can see
    const sharedAudienceCondition = isPlatformAdministrator
      ? or(
          eq(notifications.audience, 'platform'),
          and(eq(notifications.audience, 'user'), eq(notifications.recipientUserId, userId)),
        )
      : or(
          and(eq(notifications.audience, 'user'), eq(notifications.recipientUserId, userId)),
          ...(roleNames.includes(SystemRoles.TENANT_ADMIN)
            ? [eq(notifications.audience, 'tenant_admin')]
            : []),
          ...(roleNames.length
            ? [
                and(
                  eq(notifications.audience, 'role'),
                  inArray(notifications.audienceTarget, roleNames),
                )!,
              ]
            : []),
          ...(employee?.departmentId
            ? [
                and(
                  eq(notifications.audience, 'department'),
                  eq(notifications.audienceTarget, employee.departmentId),
                )!,
              ]
            : []),
          ...(employee?.officeId
            ? [
                and(
                  eq(notifications.audience, 'office'),
                  eq(notifications.audienceTarget, employee.officeId),
                )!,
              ]
            : []),
        );
    const userScopedCondition = and(
      eq(notifications.tenantId, tenantId),
      sharedAudienceCondition,
      ne(notifications.status, 'archived'),
      ne(notifications.status, 'dismissed'),
      or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace)),
    );

    if (notificationId) {
      // Look up notification — must be in this user's audience
      const [item] = await db
        .select({ id: notifications.id, audience: notifications.audience })
        .from(notifications)
        .where(and(eq(notifications.id, notificationId), userScopedCondition))
        .limit(1);
      if (!item) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });

      if (item.audience === 'user') {
        const [personal] = await db
          .select({ mandatory: notifications.mandatory, status: notifications.status })
          .from(notifications)
          .where(eq(notifications.id, notificationId))
          .limit(1);
        if (personal?.mandatory && personal.status === 'action_required') {
          return NextResponse.json(
            { error: 'Required action notifications cannot be dismissed until resolved' },
            { status: 409 },
          );
        }
        await db
          .update(notifications)
          .set({ status: 'dismissed', dismissedAt: new Date() })
          .where(eq(notifications.id, notificationId));
      } else {
        // Shared audience: dismiss for this user only
        await db
          .insert(notificationDismissals)
          .values({ notificationId, userId })
          .onConflictDoNothing();
      }
    } else {
      // Clear only eligible informational notifications. Mandatory action
      // notifications remain visible until the linked action is resolved.
      await db
        .update(notifications)
        .set({ status: 'dismissed', dismissedAt: new Date() })
        .where(
          and(
            eq(notifications.tenantId, tenantId),
            eq(notifications.audience, 'user'),
            eq(notifications.recipientUserId, userId),
            eq(notifications.mandatory, false),
            ne(notifications.status, 'action_required'),
          ),
        );
      // Dismiss only the shared notifications this user can see
      const sharedItems = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, tenantId),
            ne(notifications.audience, 'user'),
            sharedAudienceCondition,
          ),
        );
      if (sharedItems.length) {
        await db
          .insert(notificationDismissals)
          .values(sharedItems.map((n) => ({ notificationId: n.id, userId })))
          .onConflictDoNothing();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Require auth — only allow updating your own notifications
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const userId = session.user.id;
    const tenantId = session.tenantId;

    const db = getDb();
    const body = await request.json();
    const { notificationId, action } = body;
    const workspaceContext = await getSessionWorkspace(session);
    const { roleNames, activeWorkspace } = workspaceContext;
    const isPlatformAdministrator = roleNames.includes(SystemRoles.PLATFORM_ADMIN);
    const [employee] = await db
      .select({
        departmentId: employees.departmentId,
        officeId: employees.officeId,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
      .limit(1);
    const sharedAudienceCondition = isPlatformAdministrator
      ? eq(notifications.audience, 'platform')
      : or(
          ...(roleNames.includes(SystemRoles.TENANT_ADMIN)
            ? [eq(notifications.audience, 'tenant_admin')]
            : []),
          ...(roleNames.length
            ? [
                and(
                  eq(notifications.audience, 'role'),
                  inArray(notifications.audienceTarget, roleNames),
                )!,
              ]
            : []),
          ...(employee?.departmentId
            ? [
                and(
                  eq(notifications.audience, 'department'),
                  eq(notifications.audienceTarget, employee.departmentId),
                )!,
              ]
            : []),
          ...(employee?.officeId
            ? [
                and(
                  eq(notifications.audience, 'office'),
                  eq(notifications.audienceTarget, employee.officeId),
                )!,
              ]
            : []),
        );

    if (action === 'mark_read') {
      if (notificationId) {
        const [item] = await db
          .select({
            id: notifications.id,
            audience: notifications.audience,
            status: notifications.status,
          })
          .from(notifications)
          .where(
            and(
              eq(notifications.id, notificationId),
              eq(notifications.tenantId, tenantId),
              ne(notifications.status, 'archived'),
              ne(notifications.status, 'dismissed'),
              or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace)),
              or(
                and(eq(notifications.audience, 'user'), eq(notifications.recipientUserId, userId)),
                sharedAudienceCondition,
              ),
            ),
          )
          .limit(1);
        if (!item) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
        if (item.audience === 'user') {
          await db
            .update(notifications)
            .set({
              isRead: true,
              readAt: new Date(),
              status: item.status === 'action_required' ? 'action_required' : 'read',
            })
            .where(
              and(
                eq(notifications.id, notificationId),
                eq(notifications.recipientUserId, userId),
                eq(notifications.tenantId, tenantId),
              ),
            );
        } else {
          await db
            .insert(notificationReads)
            .values({ notificationId: item.id, userId })
            .onConflictDoNothing();
        }
      } else if (userId && tenantId) {
        // Mark all personal notifications as read.
        await db
          .update(notifications)
          .set({ isRead: true, readAt: new Date(), status: 'read' })
          .where(
            and(
              eq(notifications.recipientUserId, userId),
              eq(notifications.tenantId, tenantId),
              eq(notifications.isRead, false),
              ne(notifications.status, 'action_required'),
              or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace)),
            ),
          );
        const shared = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.tenantId, tenantId), sharedAudienceCondition));
        if (shared.length) {
          await db
            .insert(notificationReads)
            .values(shared.map((item) => ({ notificationId: item.id, userId })))
            .onConflictDoNothing();
        }
      }
    }

    if (action === 'update_preferences') {
      const { quietHoursStart, quietHoursEnd, emailNotifications, inAppNotifications } = body;
      const updated = await db
        .update(notificationPreferences)
        .set({
          quietHoursStart: quietHoursStart || null,
          quietHoursEnd: quietHoursEnd || null,
          emailNotifications: emailNotifications ?? true,
          inAppNotifications: inAppNotifications ?? true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.tenantId, tenantId),
          ),
        )
        .returning({ id: notificationPreferences.id });
      if (updated.length === 0) {
        await db.insert(notificationPreferences).values({
          tenantId,
          userId,
          quietHoursStart: quietHoursStart || null,
          quietHoursEnd: quietHoursEnd || null,
          emailNotifications: emailNotifications ?? true,
          inAppNotifications: inAppNotifications ?? true,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification update failed:', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}
