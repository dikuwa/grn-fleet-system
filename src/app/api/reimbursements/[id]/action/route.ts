import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql } from 'drizzle-orm';

// Ordinary Transport Office actions are deliberately forward-only. Paid claims
// are financially final here; reopening/reversing one requires a separate,
// auditable correction workflow rather than mutating history in-place.
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid', 'rejected'],
  paid: [],
  rejected: [],
};

/**
 * POST /api/reimbursements/[id]/action
 * Approve, reject, or mark as paid a reimbursement claim.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/reimbursements', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { actionType, notes } = body;

    if (!actionType || !['approved', 'rejected', 'paid'].includes(actionType)) {
      return NextResponse.json(
        { error: 'actionType must be: approved, rejected, or paid' },
        { status: 400 },
      );
    }

    const cleanNotes = String(notes || '').trim();
    if ((actionType === 'rejected' || actionType === 'paid') && !cleanNotes) {
      return NextResponse.json(
        { error: actionType === 'paid' ? 'Payment reference/notes are required' : 'Rejection reason is required' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [reimbursement] = await db
      .select({
        id: reimbursements.id,
        state: reimbursements.state,
      })
      .from(reimbursements)
      .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(reimbursements.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!reimbursement) {
      return NextResponse.json({ error: 'Reimbursement not found' }, { status: 404 });
    }

    // A same-action retry after a lost response is safe. No second audit event
    // or financial mutation is created.
    if (reimbursement.state === actionType) {
      return NextResponse.json({ success: true, state: actionType, idempotentReplay: true });
    }

    const allowedTransitions = VALID_TRANSITIONS[reimbursement.state] || [];
    if (!allowedTransitions.includes(actionType)) {
      return NextResponse.json(
        { error: `Cannot ${actionType} a reimbursement in '${reimbursement.state}' state` },
        { status: 409 },
      );
    }

    const now = new Date();
    const paidAt = actionType === 'paid' ? now : null;
    const approvedByUserId = actionType === 'approved' ? session.user.id : null;

    // Compare-and-set the exact state we just reviewed. The audit row is
    // inserted from the transitioned CTE, so a racing request that loses the
    // state claim cannot create a false audit event.
    await db.execute(sql`
      WITH transitioned AS (
        UPDATE reimbursements
        SET state = ${actionType},
            notes = ${cleanNotes || null},
            approved_by_user_id = CASE
              WHEN ${actionType} = 'approved' THEN ${approvedByUserId}
              ELSE approved_by_user_id
            END,
            paid_at = CASE
              WHEN ${actionType} = 'paid' THEN ${paidAt}
              ELSE paid_at
            END,
            updated_at = ${now}
        WHERE id = ${id}::uuid
          AND state = ${reimbursement.state}
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, before, after, reason, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${Date.now()},
          ${`reimbursement_${actionType}`},
          ${session.user.id},
          ${actionType},
          'reimbursement',
          id,
          ${`Reimbursement moved from ${reimbursement.state} to ${actionType}`},
          jsonb_build_object('state', ${reimbursement.state}),
          jsonb_build_object('state', ${actionType}),
          ${cleanNotes || null},
          'web'
        FROM transitioned
        RETURNING id
      )
      SELECT count(*) AS transitioned_count FROM transitioned
    `);

    const [current] = await db
      .select({ state: reimbursements.state })
      .from(reimbursements)
      .where(eq(reimbursements.id, id))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: 'Reimbursement no longer exists' }, { status: 404 });
    }
    if (current.state !== actionType) {
      return NextResponse.json(
        {
          error: `The reimbursement changed to '${current.state}' while you were reviewing it. Refresh before taking another action.`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, state: actionType, idempotentReplay: false });
  } catch (error) {
    console.error('[Reimbursement Action] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to process reimbursement action' },
      { status: 500 },
    );
  }
}
