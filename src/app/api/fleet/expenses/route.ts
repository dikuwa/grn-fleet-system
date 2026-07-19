import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, fuelReceipts, reimbursements } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc, sql, gte } from 'drizzle-orm';

/**
 * GET /api/fleet/expenses
 * Returns expense data: fuel costs, reimbursements, and receipt coverage
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FUEL_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '90d';

    // Date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '1y': startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
    }

    // Fuel transactions summary
    const fuelRows = await db
      .select({
        id: fuelTransactions.id,
        transactionAt: fuelTransactions.transactionAt,
        litres: fuelTransactions.litres,
        amount: fuelTransactions.amount,
        fuelType: fuelTransactions.fuelType,
        paymentMethod: fuelTransactions.paymentMethod,
        odometerReading: fuelTransactions.odometerReading,
        stationName: fuelTransactions.stationName,
        fillType: fuelTransactions.fillType,
        anomalyState: fuelTransactions.anomalyState,
        vehicleLicence: vehicles.licenceNumber,
        vehicleId: fuelTransactions.vehicleId,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicles.tenantId, session.tenantId),
          gte(fuelTransactions.transactionAt, startDate),
        ),
      )
      .orderBy(desc(fuelTransactions.transactionAt));

    // Receipt coverage
    const transactionIds = fuelRows.map((r) => r.id);
    let receiptRows: Array<{ transactionId: string; id: string; mimeType: string; isVerified: boolean }> = [];
    if (transactionIds.length > 0) {
      receiptRows = await db
        .select({
          transactionId: fuelReceipts.transactionId,
          id: fuelReceipts.id,
          mimeType: fuelReceipts.mimeType,
          isVerified: fuelReceipts.isVerified,
        })
        .from(fuelReceipts)
        .where(sql`${fuelReceipts.transactionId} IN (${transactionIds.join(',')})`);
    }
    const receiptSet = new Set(receiptRows.map((r) => r.transactionId));
    const verifiedReceiptSet = new Set(receiptRows.filter((r) => r.isVerified).map((r) => r.transactionId));

    // Missing receipts (transactions without uploaded receipt)
    const missingReceipts = fuelRows.filter((r) => !receiptSet.has(r.id));

    // Reimbursements
    const reimbursementRows = await db
      .select({
        id: reimbursements.id,
        transactionId: reimbursements.transactionId,
        amount: reimbursements.amount,
        state: reimbursements.state,
        createdAt: reimbursements.createdAt,
        claimantName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
      })
      .from(reimbursements)
      .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .leftJoin(employees, eq(reimbursements.claimantEmployeeId, employees.id))
      .where(eq(vehicles.tenantId, session.tenantId))
      .orderBy(desc(reimbursements.createdAt));

    // Summary
    const totalFuelCost = fuelRows
      .filter((r) => r.anomalyState !== 'rejected')
      .reduce((sum, r) => sum + Number(r.amount), 0);
    const totalLitres = fuelRows
      .filter((r) => r.anomalyState !== 'rejected')
      .reduce((sum, r) => sum + Number(r.litres), 0);
    const flaggedAnomalies = fuelRows.filter((r) => r.anomalyState === 'flagged').length;
    const pendingReimbursements = reimbursementRows.filter((r) => r.state === 'pending').length;

    return NextResponse.json({
      transactions: fuelRows,
      summary: {
        totalTransactions: fuelRows.length,
        totalFuelCost,
        totalLitres,
        avgCostPerLitre: totalLitres > 0 ? totalFuelCost / totalLitres : 0,
        receiptCoverage: fuelRows.length > 0 ? Math.round((receiptSet.size / fuelRows.length) * 100) : 0,
        verifiedReceipts: verifiedReceiptSet.size,
        missingReceiptCount: missingReceipts.length,
        flaggedAnomalies,
        pendingReimbursements,
        period,
      },
      missingReceipts: missingReceipts.map((r) => ({
        id: r.id,
        transactionAt: r.transactionAt,
        amount: r.amount,
        vehicleLicence: r.vehicleLicence,
        stationName: r.stationName,
      })),
      reimbursements: reimbursementRows,
    });
  } catch (error) {
    console.error('[expenses] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch expense data' }, { status: 500 });
  }
}
