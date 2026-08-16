import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { fuelTransactions, reimbursements, tripClosures, trips } from '@/db/schema/trips';

/**
 * Closure documents are generated only after reconciliation. Enrich the new
 * draft Fuel Summary with the final verified transaction rows and operational
 * identity expected by the PDF renderer. The update is draft-only; issued rows
 * remain immutable and formal issuance still owns the final official boundary.
 */
export async function enrichClosedTripFuelSummary(
  tripId: string,
  tenantId: string,
  documentId: string,
) {
  const db = getDb();

  const [context] = await db
    .select({
      tripId: trips.id,
      requestReference: transportRequests.reference,
      purpose: transportRequests.purpose,
      vehicleLicence: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      actualKilometres: tripClosures.actualKilometres,
      kilometreVariance: tripClosures.kilometreVariance,
    })
    .from(trips)
    .innerJoin(
      transportRequests,
      and(eq(transportRequests.id, trips.requestId), eq(transportRequests.tenantId, tenantId)),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, trips.vehicleId), eq(vehicles.tenantId, tenantId)),
    )
    .innerJoin(tripClosures, eq(tripClosures.tripId, trips.id))
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId), eq(trips.status, 'closed')))
    .limit(1);

  if (!context) return null;

  const transactions = await db
    .select({
      id: fuelTransactions.id,
      transactionAt: fuelTransactions.transactionAt,
      stationName: fuelTransactions.stationName,
      fuelType: fuelTransactions.fuelType,
      litres: fuelTransactions.litres,
      amount: fuelTransactions.amount,
      paymentMethod: fuelTransactions.paymentMethod,
      odometerReading: fuelTransactions.odometerReading,
      isVerified: fuelTransactions.isVerified,
    })
    .from(fuelTransactions)
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, fuelTransactions.vehicleId), eq(vehicles.tenantId, tenantId)),
    )
    .where(eq(fuelTransactions.tripId, tripId))
    .orderBy(asc(fuelTransactions.transactionAt), asc(fuelTransactions.createdAt));

  // Closure already requires every trip-linked fuel entry to be verified. Keep
  // the document fail-closed if an unexpected concurrent/unverified row exists.
  if (transactions.some((transaction) => transaction.isVerified !== true)) {
    throw new Error('Fuel Summary cannot be enriched while unverified trip fuel exists');
  }

  let outstandingReimbursements = 0;
  if (transactions.length) {
    const reimbursementRows = await db
      .select({ state: reimbursements.state })
      .from(reimbursements)
      .where(inArray(reimbursements.transactionId, transactions.map((transaction) => transaction.id)));
    // Approved claims are still financially outstanding until payment is recorded.
    outstandingReimbursements = reimbursementRows.filter((row) =>
      row.state === 'pending' || row.state === 'approved'
    ).length;
  }

  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, documentId),
        eq(generatedDocuments.tenantId, tenantId),
        eq(generatedDocuments.entityType, 'trip'),
        eq(generatedDocuments.entityId, tripId),
        eq(generatedDocuments.documentType, 'fuel_summary'),
        eq(generatedDocuments.status, 'draft'),
      ),
    )
    .limit(1);
  if (!document) return null;

  const snapshotData = {
    ...((document.snapshotData || {}) as Record<string, unknown>),
    pendingReimbursements: outstandingReimbursements,
    actualKilometres: context.actualKilometres ?? null,
    kilometreVariance: context.kilometreVariance ?? null,
    tripReference: context.requestReference,
    tripPurpose: context.purpose,
    vehicleLicence: context.vehicleLicence,
    vehicleRegisterNumber: context.vehicleRegisterNumber,
    transactions: transactions.map((transaction) => ({
      transactionAt: transaction.transactionAt.toISOString(),
      stationName: transaction.stationName || undefined,
      fuelType: transaction.fuelType,
      litres: Number(transaction.litres),
      amount: Number(transaction.amount),
      paymentMethod: transaction.paymentMethod,
      odometerReading: transaction.odometerReading,
    })),
  };

  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        documentType: document.documentType,
        version: document.documentVersion,
        snapshot: snapshotData,
      }),
    )
    .digest('hex');

  const [updated] = await db
    .update(generatedDocuments)
    .set({ snapshotData, hash, updatedAt: new Date() })
    .where(
      and(
        eq(generatedDocuments.id, document.id),
        eq(generatedDocuments.tenantId, tenantId),
        eq(generatedDocuments.status, 'draft'),
      ),
    )
    .returning();

  return updated ?? null;
}
