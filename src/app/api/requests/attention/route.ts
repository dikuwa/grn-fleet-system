/**
 * GET /api/requests/attention
 *
 * Live count of the signed-in user's draft transport requests — "new"
 * requests that have been started but not yet submitted. Uses the exact same
 * record scope as the My Drafts page (personal scope + status=draft), so the
 * sidebar badge always matches the list it links to.
 *
 * Used by the My Drafts sidebar badge and the mobile Requests quick link.
 * Counts are real tenant data only and are scoped to the signed-in user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { and, eq, sql } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { requestScopeCondition } from '@/lib/record-scope';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transportRequests)
      .where(
        and(
          requestScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: 'self',
          }),
          eq(transportRequests.status, 'draft'),
        ),
      );

    return NextResponse.json({
      success: true,
      data: { total: Number(row?.count ?? 0) },
    });
  } catch (error) {
    console.error('Requests attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load request count' }, { status: 500 });
  }
}
