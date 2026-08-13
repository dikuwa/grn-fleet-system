/**
 * GET /api/inspections/attention
 *
 * Live count of inspections that require the signed-in user's attention:
 * inspections they started (`inspectorUserId = me`) that are still
 * `in_progress`. Used by the Assigned Inspections sidebar badge in the
 * Inspector workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleInspections } from '@/db/schema/trips';
import { and, count, eq } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/inspections', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const db = getDb();
    const [row] = await db
      .select({ total: count() })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, session.tenantId),
          eq(vehicleInspections.inspectorUserId, session.user.id),
          eq(vehicleInspections.status, 'in_progress'),
        ),
      );

    return NextResponse.json({
      success: true,
      data: { total: Number(row?.total ?? 0) },
    });
  } catch (error) {
    console.error('Inspections attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
