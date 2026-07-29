/**
 * GET /api/reports/licence-expiry
 *
 * Returns all driver licences that are expired or expiring within 30 days,
 * enriched with driver details and notification status.
 *
 * Access: Transport Administrators, Tenant Administrators, Tenant Auditors
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { notifications } from '@/db/schema/notifications';
import { eq, and, gte, sql } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const now = new Date();

    // Find all active licences expiring within 30 days for this tenant
    const expiringLicences = await db
      .select({
        licenceId: driverLicences.id,
        driverName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        employeeNumber: employees.employeeNumber,
        employeeId: employees.id,
        licenceClass: driverLicences.licenceClass,
        licenceNumber: driverLicences.licenceNumber,
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        department: sql<string | null>`(SELECT name FROM departments WHERE id = ${employees.departmentId})`,
        employeeUserId: employees.userId,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(
        and(
          eq(employees.tenantId, session.tenantId),
          eq(driverLicences.isActive, true),
          sql`${driverLicences.expiryDate} <= CURRENT_DATE + INTERVAL '30 days'`,
        ),
      )
      .orderBy(driverLicences.expiryDate);

    // For each licence, check if a notification was sent today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const enriched = await Promise.all(
      expiringLicences.map(async (licence) => {
        const expiryDate = new Date(licence.expiryDate);
        const isExpired = expiryDate < now;
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        let notifiedToday = false;
        let emailSent = false;

        if (licence.employeeUserId) {
          const [existingNotification] = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.tenantId, session.tenantId),
                eq(notifications.recipientUserId, licence.employeeUserId),
                eq(notifications.entityId, licence.licenceId),
                eq(notifications.entityType, 'driver_licence'),
                gte(notifications.createdAt, todayStart),
              ),
            )
            .limit(1);

          if (existingNotification) {
            notifiedToday = true;
            emailSent = true;
          }
        }

        return {
          licenceId: licence.licenceId,
          driverName: licence.driverName,
          employeeNumber: licence.employeeNumber,
          employeeId: licence.employeeId,
          licenceClass: licence.licenceClass,
          licenceNumber: licence.licenceNumber,
          expiryDate: licence.expiryDate,
          verificationStatus: licence.verificationStatus,
          daysUntilExpiry,
          isExpired,
          department: licence.department,
          notifiedToday,
          emailSent,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      licences: enriched,
      summary: {
        total: enriched.length,
        expired: enriched.filter((l) => l.isExpired).length,
        expiring: enriched.filter((l) => !l.isExpired).length,
        notifiedToday: enriched.filter((l) => l.notifiedToday).length,
      },
    });
  } catch (error: any) {
    if (error?.message?.includes('Unauthorized') || error?.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[reports/licence-expiry] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to load licence expiry report' },
      { status: 500 },
    );
  }
}
