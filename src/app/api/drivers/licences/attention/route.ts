/**
 * GET /api/drivers/licences/attention
 *
 * Live count of driver licences awaiting verification for the tenant
 * (verificationStatus in the pending-review set, active records only).
 * Used by the Licence Verification sidebar badge in the Transport
 * Administration workspace. Mirrors the licence queue's pending definition.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const PENDING_REVIEW = ['uploaded', 'awaiting_review', 'needs_correction', 'pending'] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/drivers/licences',
      'view',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requireAnyPermission(session, [
      Permissions.LICENCE_VERIFY,
      Permissions.DRIVER_MANAGE,
      Permissions.STAFF_VIEW,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;
    const db = getDb();

    const [row] = await db
      .select({ total: count() })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(
        and(
          eq(employees.tenantId, session.tenantId),
          eq(driverLicences.isActive, true),
          inArray(driverLicences.verificationStatus, [...PENDING_REVIEW]),
        ),
      );

    return NextResponse.json({
      success: true,
      data: { total: Number(row?.total ?? 0) },
    });
  } catch (error) {
    console.error('Driver licence attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
