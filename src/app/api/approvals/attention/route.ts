/**
 * GET /api/approvals/attention
 *
 * Live count of active approvals visible to the signed-in user for their
 * tenant. Uses the exact queue predicate as the approvals page — the current
 * step is assigned to the user OR the step is unassigned and the user holds
 * its required permission (`activeApprovalVisibleTo`).
 *
 * Used by the Approvals sidebar badge. Counts are real tenant data only and
 * are permission-scoped per user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { workflowInstances, workflowSteps } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { eq, and, sql } from 'drizzle-orm';
import { requireRequestAuth, getSessionPermissions } from '@/lib/auth-helpers';
import { activeApprovalVisibleTo } from '@/lib/approval-queue';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    const permissionCodes = await getSessionPermissions(session);
    // innerJoin on workflowSteps (unlike the approvals page's leftJoin) is
    // deliberate: ad-hoc instances have no workflowSteps rows and are invisible
    // on the page too, so they are excluded from the count the same way.
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowInstances)
      .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .innerJoin(
        workflowSteps,
        and(
          eq(workflowSteps.definitionId, workflowInstances.definitionId),
          eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
        ),
      )
      .where(
        and(
          eq(workflowInstances.status, 'active'),
          eq(transportRequests.tenantId, session.tenantId),
          activeApprovalVisibleTo(session.user.id, permissionCodes),
        ),
      );

    return NextResponse.json({
      success: true,
      data: { total: Number(row?.count ?? 0) },
    });
  } catch (error) {
    console.error('Approvals attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
