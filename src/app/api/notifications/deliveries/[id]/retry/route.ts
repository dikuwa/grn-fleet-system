/**
 * POST /api/notifications/deliveries/[id]/retry
 *
 * Retry a failed notification delivery.
 * Only supports 'email' channel retries via Resend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { notificationDeliveries, notifications } from '@/db/schema/notifications';
import { employees } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function summariseDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Do not authorize this mutation from the union of every role attached to
    // the account. The active workspace must itself expose the operational
    // Delivery Dashboard; this keeps Audit and other read-only workspaces from
    // inheriting retry capability from a second role on the same user.
    const workspaceCheck = await requireDashboardAction(
      session,
      '/dashboard/notifications/deliveries',
      'update',
    );
    if (workspaceCheck instanceof NextResponse) return workspaceCheck;

    const permCheck = await requireAnyPermission(session, [
      Permissions.TENANT_MANAGE,
      Permissions.DRIVER_MANAGE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [delivery] = await db
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        attempt: notificationDeliveries.attempt,
        status: notificationDeliveries.status,
        notificationId: notificationDeliveries.notificationId,
        notification: {
          id: notifications.id,
          title: notifications.title,
          body: notifications.body,
          type: notifications.type,
          recipientUserId: notifications.recipientUserId,
          entityType: notifications.entityType,
          tenantId: notifications.tenantId,
        },
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
      .where(
        and(
          eq(notificationDeliveries.id, id),
          eq(notifications.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }

    if (delivery.status !== 'failed') {
      return NextResponse.json(
        { error: 'Only failed deliveries can be retried' },
        { status: 400 },
      );
    }

    if (delivery.channel !== 'email') {
      return NextResponse.json(
        { error: `Retry not supported for channel: ${delivery.channel}` },
        { status: 400 },
      );
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return NextResponse.json(
        { error: 'Email service not configured (RESEND_API_KEY missing)' },
        { status: 503 },
      );
    }

    let recipientEmail: string | null = null;
    if (delivery.notification.recipientUserId) {
      const [employee] = await db
        .select({ email: employees.email })
        .from(employees)
        .where(
          and(
            eq(employees.userId, delivery.notification.recipientUserId),
            eq(employees.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      recipientEmail = employee?.email?.trim() || null;

      // Not every tenant login account has a Staff record (for example some
      // administrative/service accounts). The notification itself is already
      // tenant-scoped above, so it is safe to fall back to the Better Auth
      // account email for the same recipient user id.
      if (!recipientEmail) {
        const [recipientUser] = await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, delivery.notification.recipientUserId))
          .limit(1);
        recipientEmail = recipientUser?.email?.trim() || null;
      }
    }

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email address not found' },
        { status: 404 },
      );
    }

    const resend = new Resend(resendApiKey);
    const safeTitle = escapeHtml(delivery.notification.title);
    const safeBody = escapeHtml(delivery.notification.body || delivery.notification.title).replaceAll('\n', '<br />');

    let retryStatus: 'sent' | 'failed' = 'failed';
    let retryErrorSummary: string | undefined;
    let providerId: string | null = null;

    try {
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'noreply@grnfleet.gov.na',
        to: recipientEmail,
        subject: delivery.notification.title,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1F2937; border-bottom: 2px solid #E5E7EB; padding-bottom: 8px;">
              ${safeTitle}
            </h2>
            <p style="color: #374151; font-size: 15px; line-height: 1.6;">
              ${safeBody}
            </p>
            <p style="color: #6B7280; font-size: 13px;">
              This is a retry attempt for a failed notification delivery.
            </p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 16px 0;" />
            <p style="color: #9CA3AF; font-size: 12px;">
              This is an automated message from the Government Fleet Management System.
            </p>
          </div>
        `,
      });

      if (result.error) {
        throw new Error(result.error.message || 'Email provider rejected the retry');
      }

      providerId = result.data?.id ?? null;
      retryStatus = 'sent';
    } catch (retryError) {
      retryStatus = 'failed';
      retryErrorSummary = summariseDeliveryError(retryError);
    }

    const [newRecord] = await db
      .insert(notificationDeliveries)
      .values({
        notificationId: delivery.notificationId,
        channel: 'email',
        attempt: delivery.attempt + 1,
        status: retryStatus,
        providerId,
        errorSummary: retryErrorSummary,
      })
      .returning();

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: retryStatus === 'sent' ? 'notification.delivery-retried' : 'notification.delivery-retry-failed',
      entityType: 'notification_delivery',
      entityId: newRecord.id,
      after: {
        notificationId: delivery.notificationId,
        previousDeliveryId: delivery.id,
        attempt: newRecord.attempt,
        channel: newRecord.channel,
        status: retryStatus,
        providerId,
      },
      summary: retryStatus === 'sent'
        ? `Retried notification delivery attempt ${newRecord.attempt}`
        : `Notification delivery retry attempt ${newRecord.attempt} failed`,
    });

    if (retryStatus === 'failed') {
      return NextResponse.json(
        {
          error: retryErrorSummary || 'Email provider rejected the retry',
          data: newRecord,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: newRecord });
  } catch (error) {
    console.error('[deliveries/retry] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to retry delivery: ' + summariseDeliveryError(error) },
      { status: 500 },
    );
  }
}
