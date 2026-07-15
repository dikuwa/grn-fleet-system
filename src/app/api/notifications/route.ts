import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { notifications, notificationPreferences } from '@/db/schema/notifications';
import { eq, and, desc, count } from 'drizzle-orm';
import { getServerSessionFromRequest } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Get session (fall back to query params for dev)
    const session = await getServerSessionFromRequest(request);
    const userId = session?.user?.id || searchParams.get('userId') || 'system';
    const tenantId = session?.tenantId || searchParams.get('tenantId') || '00000000-0000-0000-0000-000000000001';

    const type = searchParams.get('type');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = getDb();

    const conditions = [
      eq(notifications.recipientUserId, userId),
      eq(notifications.tenantId, tenantId),
    ];

    if (type && type !== 'all') {
      conditions.push(eq(notifications.type, type));
    }

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    const whereClause = and(...conditions);

    const [unreadCount] = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          eq(notifications.tenantId, tenantId),
          eq(notifications.isRead, false),
        ),
      );

    const items = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return NextResponse.json({
      success: true,
      data: {
        notifications: items,
        unreadCount: unreadCount?.count || 0,
      },
    });
  } catch (error) {
    console.error('Notifications API failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications: ' + String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Get session (fall back to body values for dev)
    const session = await getServerSessionFromRequest(request);
    const userId = session?.user?.id || body.userId || 'system';
    const tenantId = session?.tenantId || body.tenantId;

    const { notificationId, action } = body;

    if (action === 'mark_read') {
      if (notificationId) {
        await db
          .update(notifications)
          .set({ isRead: true, readAt: new Date() })
          .where(eq(notifications.id, notificationId));
      } else if (userId && tenantId) {
        // Mark all as read
        await db
          .update(notifications)
          .set({ isRead: true, readAt: new Date() })
          .where(
            and(
              eq(notifications.recipientUserId, userId),
              eq(notifications.tenantId, tenantId),
              eq(notifications.isRead, false),
            ),
          );
      }
    }

    if (action === 'update_preferences') {
      const { quietHoursStart, quietHoursEnd, emailNotifications, inAppNotifications } = body;
      await db
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
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification update failed:', error);
    return NextResponse.json(
      { error: 'Failed to update notifications: ' + String(error) },
      { status: 500 },
    );
  }
}
