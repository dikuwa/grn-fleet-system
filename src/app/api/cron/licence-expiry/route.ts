/**
 * GET /api/cron/licence-expiry
 *
 * Server-side cron endpoint that checks all driver licences for:
 *  - Already expired licences (sends immediate alert)
 *  - Licences expiring within 30 days (sends reminder)
 *
 * Designed to be called from Vercel Cron Jobs or a scheduled task.
 * Protected by CRON_SECRET environment variable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getDb } from '@/db';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { notifications } from '@/db/schema/notifications';
import { eq, and, gte, sql } from 'drizzle-orm';

export const maxDuration = 120; // 2 min timeout for large tenants

export async function GET(request: NextRequest) {
  // Protect with CRON_SECRET env var
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.CRON_SECRET;
  if (expectedToken) {
    const provided = authHeader?.replace('Bearer ', '') || request.nextUrl.searchParams.get('token') || '';
    if (provided !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const db = getDb();
    const now = new Date();

    // Find all active licences that are expired or expiring within 30 days
    const expiringLicences = await db
      .select({
        licenceId: driverLicences.id,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
        holderName: driverLicences.holderName,
        verificationStatus: driverLicences.verificationStatus,
        driverProfileId: driverLicences.driverProfileId,
        employeeId: driverProfiles.employeeId,
        employeeUserId: employees.userId,
        employeeEmail: employees.email,
        employeePhone: employees.phone,
        employeeName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        tenantId: employees.tenantId,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
      .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
      .where(
        and(
          eq(driverLicences.isActive, true),
          sql`${driverLicences.expiryDate} <= CURRENT_DATE + INTERVAL '30 days'`,
        ),
      );

    // Group by tenant
    const byTenant = new Map<string, typeof expiringLicences>();
    for (const licence of expiringLicences) {
      const tenantId = licence.tenantId;
      if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
      byTenant.get(tenantId)!.push(licence);
    }

    const results: Array<{
      tenantId: string;
      licenceId: string;
      notificationCreated: boolean;
      isExpired: boolean;
      daysUntilExpiry: number;
    }> = [];

    // Create notifications for each affected driver
    for (const [tenantId, licences] of byTenant) {
      for (const licence of licences) {
        const expiryDate = new Date(licence.expiryDate);
        const isExpired = expiryDate < now;
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (!licence.employeeUserId) {
          results.push({
            tenantId,
            licenceId: licence.licenceId,
            notificationCreated: false,
            isExpired,
            daysUntilExpiry,
          });
          continue; // No user account linked — skip notification
        }

        // Check if we already sent a notification today for this licence
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const [existing] = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.tenantId, tenantId),
              eq(notifications.recipientUserId, licence.employeeUserId),
              eq(notifications.entityType, 'driver_licence'),
              eq(notifications.entityId, licence.licenceId),
              gte(notifications.createdAt, todayStart),
            ),
          )
          .limit(1);

        if (existing) {
          results.push({
            tenantId,
            licenceId: licence.licenceId,
            notificationCreated: false,
            isExpired,
            daysUntilExpiry,
          });
          continue; // Already notified today — skip
        }

        // Create the notification
        const title = isExpired
          ? `Driving Licence Expired — ${licence.licenceClass} (${licence.licenceNumber.slice(-4)})`
          : `Licence Expiring Soon — ${licence.licenceClass} (${licence.licenceNumber.slice(-4)})`;

        const body = isExpired
          ? `Your ${licence.licenceClass} driving licence expired on ${expiryDate.toLocaleDateString('en-NA')}. Please renew it to remain eligible for driving assignments.`
          : `Your ${licence.licenceClass} driving licence expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${expiryDate.toLocaleDateString('en-NA')}). Please arrange renewal.`;

        await db.insert(notifications).values({
          tenantId,
          recipientUserId: licence.employeeUserId,
          audience: 'user',
          type: isExpired ? 'emergency' : 'reminder',
          title,
          body,
          entityType: 'driver_licence',
          entityId: licence.licenceId,
          actionUrl: '/dashboard/driver-self-service',
          priority: isExpired ? 'high' : 'normal',
        });

        // Send email notification if Resend is configured
        const resendApiKey = process.env.RESEND_API_KEY;
        const emailFrom = process.env.EMAIL_FROM;
        if (resendApiKey && emailFrom && licence.employeeEmail) {
          try {
            const resend = new Resend(resendApiKey);
            await resend.emails.send({
              from: emailFrom,
              to: licence.employeeEmail,
              subject: title,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: ${isExpired ? '#DC2626' : '#D97706'}; border-bottom: 2px solid #E5E7EB; padding-bottom: 8px;">
                    ${isExpired ? '⚠️' : '⏰'} ${title}
                  </h2>
                  <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                    Dear <strong>${licence.employeeName}</strong>,
                  </p>
                  <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                    ${body}
                  </p>
                  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr>
                      <td style="padding: 8px 12px; background: #F9FAFB; border: 1px solid #E5E7EB; font-weight: 600;">Licence Class</td>
                      <td style="padding: 8px 12px; background: #F9FAFB; border: 1px solid #E5E7EB;">${licence.licenceClass}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 12px; border: 1px solid #E5E7EB; font-weight: 600;">Licence Number</td>
                      <td style="padding: 8px 12px; border: 1px solid #E5E7EB;">${licence.licenceNumber}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 12px; background: #F9FAFB; border: 1px solid #E5E7EB; font-weight: 600;">Expiry Date</td>
                      <td style="padding: 8px 12px; background: #F9FAFB; border: 1px solid #E5E7EB;">${expiryDate.toLocaleDateString('en-NA')}</td>
                    </tr>
                  </table>
                  <p style="color: #6B7280; font-size: 13px;">
                    Please log in to the fleet management system to update your licence information:
                    <br /><a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/dashboard/driver-self-service" style="color: #2563EB;">Driver Self-Service Portal</a>
                  </p>
                  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 16px 0;" />
                  <p style="color: #9CA3AF; font-size: 12px;">
                    This is an automated message from the Government Fleet Management System.
                    ${isExpired ? 'Please renew your licence at your earliest convenience.' : ''}
                  </p>
                </div>
              `,
            });
            console.log(`[cron/licence-expiry] Email sent to ${licence.employeeEmail} for licence ${licence.licenceNumber}`);
          } catch (emailError) {
            console.error(`[cron/licence-expiry] Failed to send email to ${licence.employeeEmail}:`, emailError);
          }
        }

        results.push({
          tenantId,
          licenceId: licence.licenceId,
          notificationCreated: true,
          isExpired,
          daysUntilExpiry,
        });
      }
    }

    return NextResponse.json({
      success: true,
      checked: expiringLicences.length,
      notificationsCreated: results.filter((r) => r.notificationCreated).length,
      alreadyNotified: results.filter((r) => !r.notificationCreated).length,
      results,
    });
  } catch (error) {
    console.error('[cron/licence-expiry] Failed:', error);
    return NextResponse.json(
      { error: 'Licence expiry check failed: ' + String(error) },
      { status: 500 },
    );
  }
}
