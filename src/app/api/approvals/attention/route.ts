/**
 * GET /api/approvals/attention
 *
 * Live count of active approvals visible to the signed-in user for their
 * tenant. Uses the exact runtime-resolved queue logic as the approvals page.
 *
 * Used by the Approvals sidebar badge. Counts are real tenant data only and
 * are permission-scoped per user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireRequestAuth, getSessionPermissions } from '@/lib/auth-helpers';
import { resolveActionableApprovalInstanceIds } from '@/lib/approval-queue';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    const permissionCodes = await getSessionPermissions(session);
    const instanceIds = await resolveActionableApprovalInstanceIds({
      db,
      tenantId: session.tenantId,
      userId: session.user.id,
      permissionCodes,
    });

    return NextResponse.json({
      success: true,
      data: { total: instanceIds.length },
    });
  } catch (error) {
    console.error('Approvals attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
