import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid', 'rejected'],
  paid: ['rejected'],
  rejected: ['approved'],
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

    // Require fuel manage permission (reimbursements are fuel-related)
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

    const db = getDb();

    // Verify reimbursement exists and belongs to this tenant
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

    // Validate state transition
    const allowedTransitions = VALID_TRANSITIONS[reimbursement.state] || [];
    if (!allowedTransitions.includes(actionType)) {
      return NextResponse.json(
        { error: `Cannot ${actionType} a reimbursement in '${reimbursement.state}' state` },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {
      state: actionType,
      approvedByUserId: session.user.id,
      notes: notes || null,
      updatedAt: new Date(),
    };

    if (actionType === 'paid') {
      updateData.paidAt = new Date();
    }

    await db
      .update(reimbursements)
      .set(updateData)
      .where(eq(reimbursements.id, id));

    return NextResponse.json({ success: true, state: actionType });
  } catch (error) {
    console.error('[Reimbursement Action] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to process reimbursement action' },
      { status: 500 },
    );
  }
}
