import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { vehicles } from '@/db/schema/fleet';
import { requestRoutes } from '@/db/schema/requests';
import {
  fuelTransactions,
  reimbursements,
  tripClosures,
  tripIncidents,
  trips,
} from '@/db/schema/trips';

const DEFECT_TYPES = new Set([
  'mechanical_defect',
  'electrical_defect',
  'vehicle_defect',
  'tyre_failure',
  'tyre_damage',
]);

/**
 * Refresh an unissued Trip Completion document from the closed-trip boundary.
 * Closure facts remain immutable, while incident investigation fields may
 * legitimately progress after reconciliation. Formal Issue therefore freezes
 * the latest safety/investigation state without mutating historical issued docs.
 */
export async function refreshTripCompletionDraftForIssue(
  tripId: string,
  tenantId: string,
  documentId: string,
) {
  const db = getDb();
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId), eq(trips.status, 'closed')))
    .limit(1);
  if (!trip) return null;

  const [[closure], incidents, [vehicle], fuel] = await Promise.all([
    db.select().from(tripClosures).where(eq(tripClosures.tripId, tripId)).limit(1),
    db
      .select()
      .from(tripIncidents)
      .where(and(eq(tripIncidents.tripId, tripId), eq(tripIncidents.tenantId, tenantId)))
      .orderBy(tripIncidents.occurredAt),
    db
      .select({
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1),
    db
      .select({
        id: fuelTransactions.id,
        litres: fuelTransactions.litres,
        amount: fuelTransactions.amount,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, and(eq(vehicles.id, fuelTransactions.vehicleId), eq(vehicles.tenantId, tenantId)))
      .where(eq(fuelTransactions.tripId, tripId)),
  ]);

  if (!closure || !vehicle) return null;

  let outstandingReimbursements = 0;
  if (fuel.length) {
    const reimbursementsForTrip = await db
      .select({ state: reimbursements.state })
      .from(reimbursements)
      .where(inArray(reimbursements.transactionId, fuel.map((transaction) => transaction.id)));
    outstandingReimbursements = reimbursementsForTrip.filter((item) =>
      item.state === 'pending' || item.state === 'approved'
    ).length;
  }

  const totalLitres = fuel.reduce((sum, transaction) => sum + Number(transaction.litres), 0);
  const totalCost = fuel.reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  let routeKm: number | null = null;
  if (trip.requestId) {
    const routeRows = await db.select().from(requestRoutes).where(eq(requestRoutes.requestId, trip.requestId));
    if (routeRows.length) {
      routeKm = Math.round(
        routeRows.reduce(
          (sum, route) => sum + (route.totalKilometres ?? route.mappedDistanceKm ?? 0),
          0,
        ),
      );
    }
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
        eq(generatedDocuments.documentType, 'trip_completion'),
        eq(generatedDocuments.status, 'draft'),
      ),
    )
    .limit(1);
  if (!document) return null;

  const snapshotData = {
    tripId: trip.id,
    status: trip.status,
    vehicle: {
      licenceNumber: vehicle.licenceNumber || 'N/A',
      registrationNumber: vehicle.vehicleRegisterNumber || 'N/A',
    },
    issuedAt: trip.issuedAt?.toISOString(),
    startedAt: trip.startedAt?.toISOString(),
    returnedAt: trip.returnedAt?.toISOString(),
    closedAt: trip.closedAt?.toISOString(),
    routeKm,
    closure: {
      authorisedKm: closure.authorisedKilometres,
      actualKm: closure.actualKilometres,
      variance: closure.kilometreVariance,
      decision: closure.decision,
      notes: closure.reviewNotes,
    },
    fuelSummary: {
      tripId,
      totalLitres: Number(totalLitres.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      transactionCount: fuel.length,
      pendingReimbursements: outstandingReimbursements,
      actualKilometres: closure.actualKilometres || null,
      kilometreVariance: closure.kilometreVariance || null,
    },
    eventSummary: {
      total: incidents.length,
      incidents: incidents.filter((event) => !DEFECT_TYPES.has(event.incidentType)).length,
      defects: incidents.filter((event) => DEFECT_TYPES.has(event.incidentType)).length,
      accidents: incidents.filter((event) => ['accident', 'accident_collision'].includes(event.incidentType)).length,
      injuries: incidents.reduce((sum, event) => sum + event.numberInjured, 0),
      critical: incidents.filter((event) => event.severity === 'critical').length,
      events: incidents.map((event) => ({
        number: event.officialNumber,
        type: event.incidentType,
        severity: event.severity,
        occurredAt: event.occurredAt.toISOString(),
        continuationState: event.continuationState,
        status: event.status,
        policeReference: event.policeReference,
        description: event.description,
      })),
    },
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
