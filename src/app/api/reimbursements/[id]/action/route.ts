import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import { runAtomicMutations } from '@/lib/db-atomic';

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

    if ((actionType === 'rejected' || actionType === 'paid') && !String(notes || '').trim()) {
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
        transactionId: reimbursements.transactionId,
      })
      .from(reimbursements)
      .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(reimbursements.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!reimbursement) {
      return NextResponse.json({ error: 'Reimbursement not found' }, { status: 404 });
    }

    const allowedTransitions = VALID_TRANSITIONS[reimbursement.state] || [];
    if (!allowedTransitions.includes(actionType)) {
      return NextResponse.json(
        { error: `Cannot ${actionType} a reimbursement in '${reimbursement.state}' state` },
        { status: 409 },
      );
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      state: actionType,
      notes: String(notes || '').trim() || null,
      updatedAt: now,
    };
    if (actionType === 'approved') updateData.approvedByUserId = session.user.id;
    if (actionType === 'paid') updateData.paidAt = now;

    await runAtomicMutations((tx) => [
      tx.update(reimbursements)
        .set(updateData)
        .where(eq(reimbursements.id, id)),
      tx.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: `reimbursement_${actionType}`,
        actorUserId: session.user.id,
        action: actionType,
        entityType: 'reimbursement',
        entityId: id,
        summary: `Reimbursement moved from ${reimbursement.state} to ${actionType}`,
        before: { state: reimbursement.state },
        after: { state: actionType },
        reason: String(notes || '').trim() || null,
        sourceChannel: 'web',
      }),
    ]);

    return NextResponse.json({ success: true, state: actionType });
  } catch (error) {
    console.error('[Reimbursement Action] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to process reimbursement action' },
      { status: 500 },
    );
  }
}
