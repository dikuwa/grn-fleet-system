import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { vehicles } from '@/db/schema/fleet';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require fuel manage permission (reimbursements are fuel-related)
    const permCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await request.json();

    const { transactionId, amount, claimantEmployeeNumber, notes } = body;

    if (!transactionId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, amount' },
        { status: 400 },
      );
    }

    // Verify transaction exists and belongs to this tenant
    const [transaction] = await db
      .select({ id: fuelTransactions.id, vehicleId: fuelTransactions.vehicleId, recordedByUserId: fuelTransactions.recordedByUserId })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(fuelTransactions.id, transactionId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!transaction) {
      return NextResponse.json({ error: 'Fuel transaction not found in your organisation' }, { status: 404 });
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
