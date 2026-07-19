import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/reimbursements/[id]
 * Fetch a single reimbursement with associated fuel transaction and vehicle details.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    const [data] = await db
      .select({
        id: reimbursements.id,
        amount: reimbursements.amount,
        state: reimbursements.state,
        paidAt: reimbursements.paidAt,
        notes: reimbursements.notes,
        createdAt: reimbursements.createdAt,
        claimantFirstName: employees.firstName,
        claimantLastName: employees.lastName,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
        transactionAt: fuelTransactions.transactionAt,
        stationName: fuelTransactions.stationName,
        fuelType: fuelTransactions.fuelType,
        litres: fuelTransactions.litres,
      })
      .from(reimbursements)
      .innerJoin(employees, eq(reimbursements.claimantEmployeeId, employees.id))
      .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(reimbursements.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!data) {
      return NextResponse.json({ error: 'Reimbursement not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[reimbursements/:id] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch reimbursement' }, { status: 500 });
  }
}
