/**
 * POST /api/notifications/deliveries/[id]/retry
 *
 * Retry a failed notification delivery.
 * Only supports 'email' channel retries via Resend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getDb } from '@/db';
import { notificationDeliveries, notifications } from '@/db/schema/notifications';
import { employees } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { requireAnyPermission } from '@/lib/auth-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [
      Permissions.TENANT_MANAGE,
      Permissions.DRIVER_MANAGE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Fetch the delivery record with its notification
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

    // Find the recipient's email from employee records
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
      recipientEmail = employee?.email ?? null;
    }

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email address not found' },
        { status: 404 },
      );
    }

    // Attempt to resend the email
    let retryStatus: 'sent' | 'failed' = 'failed';
    let retryErrorSummary: string | undefined;

        try {
          const resend = new Resend(resendApiKey);
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'noreply@grnfleet.gov.na',
            to: recipientEmail,
            subject: delivery.notification.title,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1F2937; border-bottom: 2px solid #E5E7EB; padding-bottom: 8px;">
                  ${delivery.notification.title}
                </h2>
                <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                  ${delivery.notification.body || delivery.notification.title}
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
          retryStatus = 'sent';
        } catch (retryError) {
          retryStatus = 'failed';
          retryErrorSummary = String(retryError);
        }

        // Record the retry attempt
        const [newRecord] = await db
          .insert(notificationDeliveries)
          .values({
            notificationId: delivery.notificationId,
            channel: 'email',
            attempt: delivery.attempt + 1,
            status: retryStatus,
            errorSummary: retryErrorSummary,
          })
          .returning();

        return NextResponse.json({
          success: retryStatus === 'sent',
          data: newRecord,
        });
  } catch (error) {
    console.error('[deliveries/retry] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to retry delivery: ' + String(error) },
      { status: 500 },
    );
  }
}
