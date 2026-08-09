/**
 * GET /api/notifications/deliveries
 *
 * Returns notification delivery records enriched with notification details.
 * Supports filtering by status and channel.
 *
 * Access: Tenant administrators, transport administrators and tenant auditors.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { notificationDeliveries, notifications } from '@/db/schema/notifications';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [
      Permissions.TENANT_MANAGE,
      Permissions.DRIVER_MANAGE,
      Permissions.AUDIT_READ,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status'); // sent, failed, pending, skipped
    const channelFilter = searchParams.get('channel'); // email, sms, in_app
    const typeFilter = searchParams.get('type'); // notification type filter
    const parsedLimit = Number.parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 100;

    const db = getDb();
    const tenantWhere = eq(notifications.tenantId, session.tenantId);

    const conditions = [tenantWhere];
    if (statusFilter) {
      conditions.push(eq(notificationDeliveries.status, statusFilter));
    }
    if (channelFilter) {
      conditions.push(eq(notificationDeliveries.channel, channelFilter));
    }
    if (typeFilter) {
      conditions.push(eq(notifications.type, typeFilter));
    }

    const whereClause = and(...conditions);

    const [deliveries, [metricRow]] = await Promise.all([
      db
        .select({
          id: notificationDeliveries.id,
          channel: notificationDeliveries.channel,
          providerId: notificationDeliveries.providerId,
          attempt: notificationDeliveries.attempt,
          status: notificationDeliveries.status,
          errorSummary: notificationDeliveries.errorSummary,
          createdAt: notificationDeliveries.createdAt,
          notificationId: notificationDeliveries.notificationId,
          notifType: notifications.type,
          notifTitle: notifications.title,
          notifBody: notifications.body,
          entityType: notifications.entityType,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
        .where(whereClause)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(limit),
      db
        .select({
          total: sql<number>`count(*)`,
          email: sql<number>`count(*) filter (where ${notificationDeliveries.channel} = 'email')`,
          sms: sql<number>`count(*) filter (where ${notificationDeliveries.channel} = 'sms')`,
          inApp: sql<number>`count(*) filter (where ${notificationDeliveries.channel} = 'in_app')`,
          sent: sql<number>`count(*) filter (where ${notificationDeliveries.status} in ('sent', 'delivered'))`,
          failed: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'failed')`,
          pending: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'pending')`,
          skipped: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'skipped')`,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
        .where(tenantWhere),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        deliveries,
        metrics: {
          total: metricRow?.total ?? 0,
          email: metricRow?.email ?? 0,
          sms: metricRow?.sms ?? 0,
          inApp: metricRow?.inApp ?? 0,
          sent: metricRow?.sent ?? 0,
          failed: metricRow?.failed ?? 0,
          pending: metricRow?.pending ?? 0,
          skipped: metricRow?.skipped ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('[deliveries] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to load delivery data' },
      { status: 500 },
    );
  }
}
