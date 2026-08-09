import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { eq, and, sql } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * PATCH /api/requests/[id]/discard
 *
 * Discard a draft transport request. Unlike cancellation (which applies to
 * submitted/in-review requests), discard is only valid for `draft` requests.
 * The record is preserved (status -> cancelled) for audit continuity.
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

    if (!req) return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    if (req.status !== 'draft') {
      return NextResponse.json(
        { error: `A request with status "${req.status}" cannot be discarded. Draft requests only.` },
        { status: 409 },
      );
    }

    if (req.requesterUserId !== session.user.id) {
      const permCheck = await requirePermission(session, Permissions.REQUEST_CANCEL);
      if (permCheck instanceof NextResponse) return permCheck;
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || 'Draft discarded by requester';
    const now = new Date();
    const auditSequence = Date.now();

    // Claim the draft first, then create immutable audit evidence only from the
    // successful claim. A stale concurrent request cannot write a false discard
    // event after another actor has already changed the request state.
    await db.execute(sql`
      WITH draft_claim AS (
        UPDATE transport_requests
        SET status = 'cancelled', updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'draft'
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, source_channel,
          before, after, reason, summary
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'request_discarded',
          ${session.user.id},
          'discard',
          'transport_request',
          ${id}::uuid,
          'web',
          jsonb_build_object('status', 'draft'),
          jsonb_build_object('status', 'cancelled'),
          ${reason},
          ${`Draft ${req.reference} discarded`}
        FROM draft_claim
        RETURNING id
      )
      SELECT CASE
        WHEN (SELECT count(*) FROM draft_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN 1
        ELSE CAST('atomic_request_discard_failed' AS integer)
      END AS committed
    `);

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (error) {
    console.error('Discard request failed:', error);
    if (String(error).includes('atomic_request_discard_failed')) {
      return NextResponse.json(
        { error: 'This draft changed before it could be discarded. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Discard request failed' }, { status: 500 });
  }
}
