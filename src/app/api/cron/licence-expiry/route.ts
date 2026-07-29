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
