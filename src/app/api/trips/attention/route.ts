/**
 * GET /api/trips/attention
 *
 * Live count of trips that require the user's attention for the tenant:
 *   - pending            → awaiting allocation / issue / driver acknowledgement
 *   - issued, unacked    → driver acknowledgement overdue
 *   - return_due         → overdue return
 *   - return_inspection  → awaiting return inspection
 *   - closure_review     → awaiting closure review / reconciliation
 *
 * Used by the Trips sidebar badge. Counts are real tenant data only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

// Attention conditions mapped to lifecycle statuses:
//   pending            → awaiting allocation / issue / driver acknowledgement
//   unacknowledged     → required driver acknowledgement (subset of pending)
//   return_due         → overdue return
//   return_inspection  → unresolved return inspection
//   closure_review     → overdue closure / reconciliation
const ATTENTION_STATUSES = ['pending', 'return_due', 'return_inspection', 'closure_review'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    // Trips in attention-requiring lifecycle statuses, scoped by trips.tenantId
    // (trips carry their own tenantId, so no vehicle join is needed).
    const statusRows = await db
      .select({ status: trips.status, count: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(eq(trips.tenantId, session.tenantId), inArray(trips.status, ATTENTION_STATUSES)),
      )
      .groupBy(trips.status);

    // Pending trips whose driver has not yet acknowledged — informational
    // breakdown only; they are already included in the pending bucket above,
    // so they must NOT be added to the total a second time.
    const [unacknowledged] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(
          eq(trips.tenantId, session.tenantId),
          eq(trips.status, 'pending'),
          isNull(trips.driverAcknowledgedAt),
        ),
      );

    const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));
    const total = statusRows.reduce((sum, r) => sum + Number(r.count || 0), 0);

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
