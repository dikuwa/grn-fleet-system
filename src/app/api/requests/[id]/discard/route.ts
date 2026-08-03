import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { eq, and, sql } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

/**
 * PATCH /api/requests/[id]/discard
 *
 * Discard a draft transport request. Unlike cancellation (which applies to
 * submitted/in-review requests), discard is only valid for `draft` requests.
 * The record is preserved (status → cancelled) for audit continuity, and any
 * draft-only workflow state is cleaned up.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const db = getDb();

    const [req] = await db
      .select({
        id: transportRequests.id,
        status: transportRequests.status,
        requesterUserId: transportRequests.requesterUserId,
        reference: transportRequests.reference,
      })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
      .limit(1);

    if (!req) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }

    // Only drafts can be discarded
    if (req.status !== 'draft') {
      return NextResponse.json(
        {
          error: `A request with status "${req.status}" cannot be discarded. Draft requests only.`,
        },
        { status: 409 },
      );
    }

    // The requester may discard their own draft; anyone else needs request:cancel
    if (req.requesterUserId !== session.user.id) {
      const permCheck = await requirePermission(session, Permissions.REQUEST_CANCEL);
      if (permCheck instanceof NextResponse) return permCheck;
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || 'Draft discarded by requester';

    await db
      .update(transportRequests)
      .set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(eq(transportRequests.id, id));

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'request.discarded',
      entityType: 'transport_request',
      entityId: id,
      sourceChannel: 'web',
      before: { status: 'draft' },
      after: { status: 'cancelled' },
      reason,
      summary: `Draft ${req.reference} discarded (${reason})`,
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (error) {
    console.error('Discard request failed:', error);
    return NextResponse.json(
      { error: 'Discard request failed: ' + String(error) },
      { status: 500 },
    );
  }
}
