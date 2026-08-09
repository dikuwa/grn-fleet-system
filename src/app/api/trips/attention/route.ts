/**
 * GET /api/trips/attention
 *
 * Live count of trips that require the user's attention. Counts follow the
 * canonical Trips record scope: Transport Administration sees tenant-wide
 * counts; assigned workspaces only see records related to the current user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { and, isNull, inArray, sql } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';

const ATTENTION_STATUSES = ['pending', 'return_due', 'return_inspection', 'closure_review'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/trips', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/trips', roleNames);
    const scopeCondition = tripScopeCondition({
      tenantId: session.tenantId,
      userId: session.user.id,
      recordScope: access.recordScope ?? 'assigned',
    });

    const db = getDb();
    const statusRows = await db
      .select({ status: trips.status, count: sql<number>`count(*)::int` })
      .from(trips)
      .where(and(scopeCondition, inArray(trips.status, ATTENTION_STATUSES)))
      .groupBy(trips.status);

    const [unacknowledged] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(
          scopeCondition,
          sql`${trips.status} = 'pending'`,
          isNull(trips.driverAcknowledgedAt),
        ),
      );

    const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
    const total = statusRows.reduce((sum, row) => sum + Number(row.count || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        total,
        byStatus: {
          pending: byStatus.pending ?? 0,
          return_due: byStatus.return_due ?? 0,
          return_inspection: byStatus.return_inspection ?? 0,
          closure_review: byStatus.closure_review ?? 0,
          unacknowledged: Number(unacknowledged?.count || 0),
        },
      },
    });
  } catch (error) {
    console.error('Trips attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
