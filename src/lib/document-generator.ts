/**
 * Document Generator
 *
 * Produces snapshot documents (transport_requests, trip_authority,
 * vehicle_allocation, etc.) from DB data at key lifecycle events.
 *
 * Each generated document is stored in `generatedDocuments` with its
 * entityType/entityId linking it to the source record. Documents move
 * through statuses: draft → issued → superseded.
 */

import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { trips, fuelTransactions, reimbursements, vehicleInspections, tripClosures } from '@/db/schema/trips';
import { validateDocumentSnapshot, hasSchema } from '@/lib/document-validation';
import { transportRequests, requestActivities, requestDrivers } from '@/db/schema/requests';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentType =
  | 'transport_request'
  | 'trip_authority'
  | 'vehicle_allocation'
  | 'fuel_summary'
  | 'inspection_report'
  | 'trip_completion'
  | 'maintenance_report'
  | 'audit_report';

interface DocumentPayload {
  documentType: DocumentType;
  entityType: string;
  entityId: string;
  tenantId: string;
  generatedByUserId: string;
  snapshotData?: Record<string, unknown>;
  templateVersion?: string;
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

async function buildTransportRequestSnapshot(requestId: string) {
  const db = getDb();
  const [req] = await db
    .select()
    .from(transportRequests)
    .where(eq(transportRequests.id, requestId))
    .limit(1);
  if (!req) return null;

  const activities = await db
    .select()
    .from(requestActivities)
    .where(eq(requestActivities.requestId, requestId));

  const drivers = await db
    .select()
    .from(requestDrivers)
    .where(eq(requestDrivers.requestId, requestId));

  const [requester] = await db
    .select({ name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})` })
    .from(employees)
    .where(eq(employees.id, req.requesterEmployeeId))
    .limit(1);

  return {
    id: req.id,
    reference: req.reference,
    revision: req.revision,
    scope: req.scope,
    status: req.status,
    department: req.department,
    purpose: req.purpose,
    requester: requester?.name || 'Unknown',
    totalAuthorisedKilometres: req.totalAuthorisedKilometres,
    specialAuthorityRequired: req.specialAuthorityRequired,
    submittedAt: req.submittedAt?.toISOString(),
    activities: activities.map((a) => ({
      title: a.title,
      venue: a.venue,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      estimatedKilometres: a.estimatedKilometres,
    })),
    drivers: drivers.map((d) => ({
      driverType: d.driverType,
      sortOrder: d.sortOrder,
    })),
  };
}

async function buildTripAuthoritySnapshot(allocationId: string) {
  const db = getDb();
  const [alloc] = await db
    .select()
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);
  if (!alloc) return null;

  const [req] = await db
    .select()
    .from(transportRequests)
    .where(eq(transportRequests.id, alloc.requestId))
    .limit(1);

  const [vehicle] = await db
    .select({ licenceNumber: vehicles.licenceNumber, make: vehicles.make, model: vehicles.model, vehicleRegisterNumber: vehicles.vehicleRegisterNumber })
    .from(vehicles)
    .where(eq(vehicles.id, alloc.vehicleId))
    .limit(1);

  return {
    allocationId: alloc.id,
    requestReference: req?.reference || 'N/A',
    scope: req?.scope || 'regional',
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      vehicleRegisterNumber: vehicle?.vehicleRegisterNumber || 'N/A',
      make: vehicle?.make || '',
      model: vehicle?.model || '',
    },
    startAt: alloc.startAt.toISOString(),
    endAt: alloc.endAt.toISOString(),
    state: alloc.state,
    allocatedByUserId: alloc.allocatedByUserId,
  };
}

async function buildInspectionReportSnapshot(inspectionId: string) {
  const db = getDb();
  const [insp] = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.id, inspectionId))
    .limit(1);
  if (!insp) return null;

  const [vehicle] = await db
    .select({ licenceNumber: vehicles.licenceNumber, vehicleRegisterNumber: vehicles.vehicleRegisterNumber })
    .from(vehicles)
    .where(eq(vehicles.id, insp.vehicleId))
    .limit(1);

  return {
    inspectionId: insp.id,
    type: insp.type,
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'N/A',
    },
    odometerReading: insp.odometerReading,
    fuelLevel: insp.fuelLevel,
    overallPass: insp.overallPass,
    status: insp.status,
    notes: insp.notes,
    inspectedAt: insp.createdAt.toISOString(),
  };
}

async function buildFuelSummarySnapshot(tripId: string) {
  const db = getDb();
  const transactions = await db
    .select()
    .from(fuelTransactions)
    .where(eq(fuelTransactions.tripId, tripId));

  const totalLitres = transactions.reduce((sum, t) => sum + Number(t.litres), 0);
  const totalCost = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

  // Find all reimbursements linked to this trip's transactions
  let pendingReimbursements = 0;
  if (transactions.length > 0) {
    const txIds = transactions.map((t) => t.id);
    const rb = await db
      .select()
      .from(reimbursements)
      .where(inArray(reimbursements.transactionId, txIds));
    pendingReimbursements = rb.filter((r) => r.state === 'pending').length;
  }

  const [closure] = await db
    .select()
    .from(tripClosures)
    .where(eq(tripClosures.tripId, tripId))
    .limit(1);

  return {
    tripId,
    totalLitres: Number(totalLitres.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    transactionCount: transactions.length,
    pendingReimbursements,
    actualKilometres: closure?.actualKilometres || null,
    kilometreVariance: closure?.kilometreVariance || null,
  };
}

async function buildTripCompletionSnapshot(tripId: string) {
  const db = getDb();

  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!trip) return null;

  const [closure] = await db
    .select()
    .from(tripClosures)
    .where(eq(tripClosures.tripId, tripId))
    .limit(1);

  const fuelSummary = await buildFuelSummarySnapshot(tripId);

  const [vehicle] = await db
    .select({ licenceNumber: vehicles.licenceNumber, vehicleRegisterNumber: vehicles.vehicleRegisterNumber })
    .from(vehicles)
    .where(eq(vehicles.id, trip.vehicleId))
    .limit(1);

  return {
    tripId: trip.id,
    status: trip.status,
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'N/A',
    },
    issuedAt: trip.issuedAt?.toISOString(),
    startedAt: trip.startedAt?.toISOString(),
    returnedAt: trip.returnedAt?.toISOString(),
    closedAt: trip.closedAt?.toISOString(),
    closure: closure
      ? {
          authorisedKm: closure.authorisedKilometres,
          actualKm: closure.actualKilometres,
          variance: closure.kilometreVariance,
          decision: closure.decision,
          notes: closure.reviewNotes,
        }
      : null,
    fuelSummary,
  };
}

// ---------------------------------------------------------------------------
// Snapshot dispatch (by entity type + action)
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, (id: string) => Promise<Record<string, unknown> | null>> = {
  transport_request: buildTransportRequestSnapshot,
  trip: buildTripCompletionSnapshot,
  vehicle_allocation: buildTripAuthoritySnapshot,
  inspection: buildInspectionReportSnapshot,
};

/**
 * Generate a document snapshot for a given entity.
 *
 * Example usage:
 * ```ts
 * await generateDocument({
 *   documentType: 'transport_request',
 *   entityType: 'transport_request',
 *   entityId: requestId,
 *   tenantId: session.tenantId,
 *   generatedByUserId: session.user.id,
 * });
 * ```
 */
export async function generateDocument(
  payload: DocumentPayload,
): Promise<typeof generatedDocuments.$inferSelect | null> {
  const { documentType, entityType, entityId, tenantId, generatedByUserId, templateVersion } = payload;

  const builder = BUILDERS[entityType];
  if (!builder) {
    console.warn(`[DocGen] No builder for entity type: ${entityType}`);
    return null;
  }

  const snapshotData = await builder(entityId);
  if (!snapshotData) {
    console.warn(`[DocGen] No data found for ${entityType}: ${entityId}`);
    return null;
  }

  // Validate snapshot against document type schema
  if (hasSchema(documentType)) {
    const validation = validateDocumentSnapshot(documentType, snapshotData);
    if (!validation.valid) {
      console.warn(`[DocGen] Snapshot validation failed for ${documentType}:${entityId}`, validation.errors);
      // Non-blocking — store the document with a warning, but log the issue
    }
  }

  const db = getDb();

  // Check if a document already exists for this entity + type
  const [existing] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.entityType, entityType),
        eq(generatedDocuments.entityId, entityId),
        eq(generatedDocuments.documentType, documentType),
      ),
    )
    .orderBy(desc(generatedDocuments.documentVersion))
    .limit(1);

  const newVersion = existing ? existing.documentVersion + 1 : 1;

  // If there's an existing issued document, supersede it first
  if (existing && existing.status === 'issued') {
    await db
      .update(generatedDocuments)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(eq(generatedDocuments.id, existing.id));
  }

  const [doc] = await db
    .insert(generatedDocuments)
    .values({
      tenantId,
      documentType,
      documentVersion: newVersion,
      templateVersion,
      entityType,
      entityId,
      snapshotData,
      status: newVersion > 1 ? 'issued' : 'draft', // Regenerations are auto-issued
      generatedByUserId,
    })
    .returning();

  return doc;
}

// ---------------------------------------------------------------------------
// Lifecycle triggers
// ---------------------------------------------------------------------------

/**
 * Called when a transport request is submitted (not draft).
 */
export async function onRequestSubmitted(
  requestId: string,
  tenantId: string,
  userId: string,
) {
  return generateDocument({
    documentType: 'transport_request',
    entityType: 'transport_request',
    entityId: requestId,
    tenantId,
    generatedByUserId: userId,
  });
}

/**
 * Called when a trip is closed.
 */
export async function onTripClosed(
  tripId: string,
  tenantId: string,
  userId: string,
) {
  const results = await Promise.all([
    generateDocument({
      documentType: 'trip_completion',
      entityType: 'trip',
      entityId: tripId,
      tenantId,
      generatedByUserId: userId,
    }),
    generateDocument({
      documentType: 'fuel_summary',
      entityType: 'trip',
      entityId: tripId,
      tenantId,
      generatedByUserId: userId,
    }),
  ]);

  return results.filter(Boolean);
}

/**
 * Called when a trip is issued (vehicle + driver assigned).
 */
export async function onTripIssued(
  allocationId: string,
  tenantId: string,
  userId: string,
) {
  return generateDocument({
    documentType: 'trip_authority',
    entityType: 'vehicle_allocation',
    entityId: allocationId,
    tenantId,
    generatedByUserId: userId,
  });
}

/**
 * Called when an inspection is completed.
 */
export async function onInspectionCompleted(
  inspectionId: string,
  tenantId: string,
  userId: string,
) {
  return generateDocument({
    documentType: 'inspection_report',
    entityType: 'inspection',
    entityId: inspectionId,
    tenantId,
    generatedByUserId: userId,
  });
}
