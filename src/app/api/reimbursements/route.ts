import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const body = await request.json();

    const { transactionId, amount, claimantEmployeeNumber, notes } = body;

    if (!transactionId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, amount' },
        { status: 400 },
      );
    }

    // Verify transaction exists
    const [transaction] = await db
      .select()
      .from(fuelTransactions)
      .where(eq(fuelTransactions.id, transactionId))
      .limit(1);

    if (!transaction) {
      return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 });
    }

    // Resolve claimant
    let claimantEmployeeId: string | undefined;
    if (claimantEmployeeNumber) {
      const [emp] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.employeeNumber, claimantEmployeeNumber))
        .limit(1);
      if (emp) claimantEmployeeId = emp.id;
    }

    const [reimbursement] = await db
      .insert(reimbursements)
      .values({
        transactionId,
        claimantEmployeeId: claimantEmployeeId || transaction.recordedByUserId,
        amount: amount.toString(),
        state: 'pending',
        notes: notes || null,
      })
      .returning();

    return NextResponse.json({
      success: true,
      data: reimbursement,
    });
  } catch (error) {
    console.error('Reimbursement creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create reimbursement: ' + String(error) },
      { status: 500 },
    );
  }
}
