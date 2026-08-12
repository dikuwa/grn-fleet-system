import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import {
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/reimbursements', 'create');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json()) as Record<string, unknown>;
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
    const claimantEmployeeNumber =
      typeof body.claimantEmployeeNumber === 'string' ? body.claimantEmployeeNumber.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const amount = Number(body.amount);

    if (!transactionId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'A fuel transaction and positive reimbursement amount are required' },
        { status: 422 },
      );
    }

    const db = getDb();
    const [transaction] = await db
      .select({
        id: fuelTransactions.id,
        paymentMethod: fuelTransactions.paymentMethod,
        transactionAmount: fuelTransactions.amount,
        recordedByUserId: fuelTransactions.recordedByUserId,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(
        and(
          eq(fuelTransactions.id, transactionId),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!transaction) {
      return NextResponse.json({ error: 'Fuel transaction not found in your organisation' }, { status: 404 });
    }
    if (transaction.paymentMethod !== 'personal_reimbursement') {
      return NextResponse.json(
        { error: 'A reimbursement can only be created for a personal reimbursement fuel transaction' },
        { status: 409 },
      );
    }

    const transactionAmount = Number(transaction.transactionAmount);
    if (amount > transactionAmount) {
      return NextResponse.json(
        { error: `Reimbursement amount cannot exceed the fuel transaction amount (${transactionAmount.toFixed(2)})` },
        { status: 422 },
      );
    }

    const existing = await db
      .select({ id: reimbursements.id, state: reimbursements.state })
      .from(reimbursements)
      .where(eq(reimbursements.transactionId, transactionId))
      .limit(1);
    if (existing[0]) {
      return NextResponse.json(
        { error: 'A reimbursement claim already exists for this fuel transaction', claimId: existing[0].id },
        { status: 409 },
      );
    }

    const employeeCondition = claimantEmployeeNumber
      ? and(
          eq(employees.tenantId, session.tenantId),
          eq(employees.employeeNumber, claimantEmployeeNumber),
        )
      : and(
          eq(employees.tenantId, session.tenantId),
          eq(employees.userId, transaction.recordedByUserId),
        );

    const [claimant] = await db
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        employmentStatus: employees.employmentStatus,
      })
      .from(employees)
      .where(employeeCondition)
      .limit(1);

    if (!claimant) {
      return NextResponse.json(
        {
          error: claimantEmployeeNumber
            ? 'Claimant employee was not found in your organisation'
            : 'The fuel recorder is not linked to an employee record. Select the claimant explicitly.',
        },
        { status: 422 },
      );
    }
    if (claimant.employmentStatus === 'archived' || claimant.employmentStatus === 'deceased') {
      return NextResponse.json(
        { error: 'This employee cannot be used as an active reimbursement claimant' },
        { status: 422 },
      );
    }

    const reimbursementId = randomUUID();
    const now = new Date();
    try {
      await runAtomicMutations((tx) => [
        tx.insert(reimbursements).values({
          id: reimbursementId,
          transactionId,
          claimantEmployeeId: claimant.id,
          amount: amount.toFixed(2),
          state: 'pending',
          notes: notes || null,
          createdAt: now,
          updatedAt: now,
        }),
        tx.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'reimbursement_created',
          actorUserId: session.user.id,
          action: 'create',
          entityType: 'reimbursement',
          entityId: reimbursementId,
          summary: `Reimbursement claim created for ${amount.toFixed(2)}`,
          after: {
            transactionId,
            claimantEmployeeId: claimant.id,
            claimantEmployeeNumber: claimant.employeeNumber,
            amount: amount.toFixed(2),
            state: 'pending',
          },
          sourceChannel: 'web',
        }),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'A reimbursement claim already exists for this fuel transaction' },
          { status: 409 },
        );
      }
      throw error;
    }

    const [reimbursement] = await db
      .select()
      .from(reimbursements)
      .where(eq(reimbursements.id, reimbursementId))
      .limit(1);

    if (!reimbursement) {
      throw new Error('Reimbursement committed but could not be reloaded');
    }

    return NextResponse.json({ success: true, data: reimbursement }, { status: 201 });
  } catch (error) {
    console.error('[reimbursements] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create reimbursement' }, { status: 500 });
  }
}
