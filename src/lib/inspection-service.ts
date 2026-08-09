import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  inspectionItemResults,
  inspectionPhotos,
  inspectionTemplateItems,
  inspectionTemplates,
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import {
  maintenanceEvents,
  vehicleDefects,
  vehicleOdometerEvents,
  vehicles,
  vehicleStatusEvents,
} from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { runAtomicMutations } from '@/lib/db-atomic';
import { onInspectionCompleted } from '@/lib/document-generator';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

export class InspectionServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'InspectionServiceError';
  }
}

type InspectionType = 'departure' | 'return';
type ResultValue = 'pass' | 'fail' | 'not_applicable';

type InspectionInput = {
  tenantId: string;
  userId: string;
  vehicleId: string;
  tripId: string;
  type: InspectionType;
  odometerReading: number;
  fuelLevel?: string | null;
  checklist: Array<{ label?: string; result?: string; comment?: string | null }>;
  notes?: string | null;
  photoKeys?: string[];
  inspectorAcknowledged: boolean;
  driverAcknowledged: boolean;
  clientSyncId?: string | null;
};

const departureRequestStatuses = ['authorised', 'ready_for_issue', 'approved', 'approved_emergency'];
const returnTripStatuses = ['in_progress', 'return_due', 'return_inspection'];
const fuelLevels = ['empty', 'quarter', 'half', 'three_quarters', 'full'];

function fail(message: string, status = 400): never {
  throw new InspectionServiceError(message, status);
}

export async function completeOfficialInspection(input: InspectionInput) {
  const db = getDb();
  const { tenantId, userId } = input;

  if (!input.vehicleId || !input.tripId) fail('Vehicle and trip are required');
  if (!['departure', 'return'].includes(input.type)) fail('Inspection type must be departure or return');
  if (!Number.isInteger(input.odometerReading) || input.odometerReading < 0) {
    fail('Odometer must be a non-negative whole number', 422);
  }
  if (input.fuelLevel && !fuelLevels.includes(input.fuelLevel)) fail('Invalid fuel level', 422);
  if (!Array.isArray(input.checklist) || input.checklist.length === 0) fail('The complete inspection checklist is required');
  if (!input.inspectorAcknowledged || !input.driverAcknowledged) {
    fail('Inspector and witnessed driver acknowledgements are required');
  }

  if (input.clientSyncId) {
    const [existing] = await db.select().from(vehicleInspections).where(and(
      eq(vehicleInspections.tenantId, tenantId),
      eq(vehicleInspections.clientSyncId, input.clientSyncId),
    )).limit(1);
    if (existing) {
      return {
        inspection: existing,
        trip: null,
        document: null,
        overallPass: existing.overallPass,
        status: existing.status,
        idempotent: true,
      };
    }
  }

  const [vehicle] = await db.select({
    id: vehicles.id,
    status: vehicles.status,
    currentOdometer: vehicles.currentOdometer,
  }).from(vehicles).where(and(
    eq(vehicles.id, input.vehicleId),
    eq(vehicles.tenantId, tenantId),
  )).limit(1);
  if (!vehicle) fail('Vehicle not found in your tenant', 404);
  if (input.odometerReading < vehicle.currentOdometer) {
    fail(`Odometer must be at or above ${vehicle.currentOdometer}`, 422);
  }

  const [trip] = await db.select({
    id: trips.id,
    status: trips.status,
    vehicleId: trips.vehicleId,
    requestStatus: transportRequests.status,
    driverEmployeeId: vehicleAllocations.driverEmployeeId,
    authorityId: tripAuthorities.id,
    authorityStatus: tripAuthorities.status,
  }).from(trips)
    .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .where(and(
      eq(trips.id, input.tripId),
      eq(trips.tenantId, tenantId),
      eq(transportRequests.tenantId, tenantId),
    )).limit(1);
  if (!trip || trip.vehicleId !== input.vehicleId) fail('Trip and vehicle do not match', 404);
  if (!trip.driverEmployeeId) fail('A valid driver must be assigned before inspection', 409);

  if (input.type === 'departure') {
    if (trip.status !== 'pending' || !departureRequestStatuses.includes(trip.requestStatus)) {
      fail('Departure inspection requires final authorisation', 409);
    }
    if (!['driver_accepted', 'awaiting_pre_trip_inspection'].includes(trip.authorityStatus)) {
      fail('The assigned driver must accept the Trip Authority before inspection', 409);
    }
    const [blocking] = await db.select({ count: sql<number>`count(*)` }).from(vehicleDefects).where(and(
      eq(vehicleDefects.vehicleId, input.vehicleId),
      isNull(vehicleDefects.resolvedAt),
      eq(vehicleDefects.isBlocking, true),
    ));
    if (Number(blocking?.count ?? 0) > 0) {
      fail('Departure inspection blocked: resolve all critical or blocking defects first', 409);
    }
  } else {
    if (!returnTripStatuses.includes(trip.status)) fail('Return inspection is only available after trip execution', 409);
    if (!['returned', 'awaiting_arrival_inspection'].includes(trip.authorityStatus)) {
      fail('Trip Authority is not ready for arrival inspection', 409);
    }
  }

  const [template] = await db.select({
    id: inspectionTemplates.id,
    version: inspectionTemplates.version,
  }).from(inspectionTemplates).where(and(
    eq(inspectionTemplates.tenantId, tenantId),
    eq(inspectionTemplates.type, input.type),
    eq(inspectionTemplates.isActive, true),
  )).orderBy(desc(inspectionTemplates.version)).limit(1);
  if (!template) fail('No active inspection template is configured', 409);

  const templateItems = await db.select().from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);
  if (!templateItems.length) fail('The active inspection template has no checklist items', 409);

  const submitted = new Map<string, InspectionInput['checklist'][number]>();
  for (const item of input.checklist) {
    if (!item.label || submitted.has(item.label)) fail('Submit every checklist item exactly once', 422);
    submitted.set(item.label, item);
  }
  if (submitted.size !== templateItems.length || templateItems.some((item) => !submitted.has(item.label))) {
    fail('Submit every item from the active inspection template exactly once', 422);
  }

  const evaluatedItems = templateItems.map((item) => {
    const supplied = submitted.get(item.label)!;
    const result = supplied.result === 'na' ? 'not_applicable' : supplied.result;
    if (!['pass', 'fail', 'not_applicable'].includes(result || '')) {
      fail('Inspection results must be pass, fail, or not applicable', 422);
    }
    if (result === 'fail' && !supplied.comment?.trim()) {
      fail(`A defect description is required for “${item.label}”`, 422);
    }
    return {
      ...item,
      result: result as ResultValue,
      comment: supplied.comment?.trim() || null,
    };
  });

  const photoKeys = Array.from(new Set((input.photoKeys ?? []).filter(Boolean)));
  const expectedPrefix = `tenant/${tenantId}/inspections/`;
  if (photoKeys.some((key) => !key.startsWith(expectedPrefix))) {
    fail('Inspection evidence contains an invalid storage key', 422);
  }
  const requiredPhotos = evaluatedItems.filter((item) => item.requiresPhoto).length;
  if (photoKeys.length < requiredPhotos) fail(`At least ${requiredPhotos} inspection photos are required`, 422);

  const failedItems = evaluatedItems.filter((item) => item.result === 'fail');
  const overallPass = failedItems.length === 0;
  const criticalFailure = failedItems.some((item) => item.isCritical);
  const status = criticalFailure ? 'failed' : 'completed';
  const maintenanceUsers = failedItems.length
    ? await resolveActiveRoleRecipients(tenantId, [SystemRoles.MAINTENANCE])
    : [];

  const now = new Date();
  const inspectionId = randomUUID();
  const defectIds = new Map(failedItems.map((item) => [item.id, randomUUID()]));
  const sourceChannel = input.clientSyncId ? 'offline_sync' : 'web';

  await runAtomicMutations((tx) => {
    const queries: any[] = [
      tx.insert(vehicleInspections).values({
        id: inspectionId,
        tenantId,
        vehicleId: input.vehicleId,
        tripId: input.tripId,
        templateId: template.id,
        templateVersion: template.version,
        type: input.type,
        odometerReading: input.odometerReading,
        fuelLevel: input.fuelLevel || null,
        inspectorUserId: userId,
        driverEmployeeId: trip.driverEmployeeId,
        status,
        overallPass,
        signatureInspector: `acknowledged:${userId}:${now.toISOString()}`,
        signatureDriver: `witnessed_by_inspector:${userId}:driver:${trip.driverEmployeeId}:${now.toISOString()}`,
        notes: input.notes?.trim() || null,
        clientSyncId: input.clientSyncId || null,
      }),
    ];

    // Defects must exist before checklist rows reference them through defect_id.
    if (failedItems.length) {
      queries.push(tx.insert(vehicleDefects).values(failedItems.map((item) => ({
        id: defectIds.get(item.id)!,
        vehicleId: input.vehicleId,
        tripId: input.tripId,
        inspectionId,
        severity: item.isCritical ? 'critical' : 'major',
        description: item.comment || `Inspection item failed: ${item.label}`,
        isBlocking: item.isCritical,
        reportedByUserId: userId,
        assignedToUserId: maintenanceUsers[0] ?? null,
      }))));
    }

    queries.push(tx.insert(inspectionItemResults).values(evaluatedItems.map((item) => ({
      inspectionId,
      templateItemId: item.id,
      result: item.result,
      comment: item.comment,
      defectId: defectIds.get(item.id) ?? null,
    }))));

    if (criticalFailure) {
      queries.push(tx.update(vehicles).set({ status: 'maintenance', updatedAt: now }).where(and(
        eq(vehicles.id, input.vehicleId),
        eq(vehicles.tenantId, tenantId),
      )));
      queries.push(tx.insert(maintenanceEvents).values({
        vehicleId: input.vehicleId,
        serviceDate: now.toISOString().slice(0, 10),
        serviceOdometer: input.odometerReading,
        serviceType: 'inspection',
        description: `Critical ${input.type} inspection defect follow-up`,
        notes: `Automatically escalated from inspection ${inspectionId}`,
        createdByUserId: userId,
        assignedToUserId: maintenanceUsers[0] ?? null,
      }));
      queries.push(tx.insert(vehicleStatusEvents).values({
        vehicleId: input.vehicleId,
        previousStatus: vehicle.status,
        newStatus: 'maintenance',
        reason: `Critical defect in ${input.type} inspection`,
        changedByUserId: userId,
        referenceEntityType: 'inspection',
        referenceEntityId: inspectionId,
      }));
    }

    if (input.type === 'departure') {
      if (trip.authorityStatus === 'driver_accepted') {
        queries.push(tx.update(tripAuthorities)
          .set({ status: 'awaiting_pre_trip_inspection', updatedAt: now })
          .where(and(
            eq(tripAuthorities.id, trip.authorityId),
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.status, 'driver_accepted'),
          )));
      }
      if (overallPass) {
        const expected = trip.authorityStatus === 'driver_accepted'
          ? 'awaiting_pre_trip_inspection'
          : 'awaiting_pre_trip_inspection';
        queries.push(tx.update(tripAuthorities)
          .set({ status: 'ready_for_departure', beginningOdometer: input.odometerReading, updatedAt: now })
          .where(and(
            eq(tripAuthorities.id, trip.authorityId),
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.status, expected),
          )));
      }
    } else {
      queries.push(tx.update(trips)
        .set({ status: 'closure_review', returnedAt: now, updatedAt: now })
        .where(and(
          eq(trips.id, input.tripId),
          eq(trips.tenantId, tenantId),
          inArray(trips.status, returnTripStatuses),
        )));
      if (trip.authorityStatus === 'returned') {
        queries.push(tx.update(tripAuthorities)
          .set({ status: 'awaiting_arrival_inspection', updatedAt: now })
          .where(and(
            eq(tripAuthorities.id, trip.authorityId),
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.status, 'returned'),
          )));
      }
      queries.push(tx.update(tripAuthorities)
        .set({ status: 'awaiting_reconciliation', endingOdometer: input.odometerReading, updatedAt: now })
        .where(and(
          eq(tripAuthorities.id, trip.authorityId),
          eq(tripAuthorities.tenantId, tenantId),
          eq(tripAuthorities.status, 'awaiting_arrival_inspection'),
        )));
    }

    if (photoKeys.length) {
      queries.push(tx.insert(inspectionPhotos).values(photoKeys.map((fileKey) => ({
        inspectionId,
        fileKey,
        stage: input.type,
      }))));
    }
    queries.push(tx.insert(vehicleOdometerEvents).values({
      vehicleId: input.vehicleId,
      odometerValue: input.odometerReading,
      source: 'inspection',
      sourceEntityType: 'inspection',
      sourceEntityId: inspectionId,
      recordedByUserId: userId,
    }));
    queries.push(tx.update(vehicles)
      .set({ currentOdometer: sql`greatest(${vehicles.currentOdometer}, ${input.odometerReading})`, updatedAt: now })
      .where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.tenantId, tenantId))));
    queries.push(tx.insert(auditEvents).values({
      tenantId,
      tenantSequence: Date.now(),
      eventType: 'inspection_completed',
      actorUserId: userId,
      action: 'complete',
      entityType: 'inspection',
      entityId: inspectionId,
      correlationId: input.clientSyncId || inspectionId,
      sourceChannel,
      summary: `${input.type} inspection ${status}; ${failedItems.length} defect(s) recorded`,
      after: {
        tripId: input.tripId,
        vehicleId: input.vehicleId,
        templateId: template.id,
        templateVersion: template.version,
        overallPass,
        criticalDefects: failedItems.filter((item) => item.isCritical).length,
        driverAcknowledgementMethod: 'inspector_witnessed',
      },
    }));
    return queries;
  });

  const [inspection, updatedTrip] = await Promise.all([
    db.select().from(vehicleInspections).where(and(
      eq(vehicleInspections.id, inspectionId),
      eq(vehicleInspections.tenantId, tenantId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(trips).where(and(
      eq(trips.id, input.tripId),
      eq(trips.tenantId, tenantId),
    )).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (!inspection) throw new Error('Inspection committed but could not be reloaded');

  if (failedItems.length && maintenanceUsers.length) {
    try {
      await createScopedNotifications({
        tenantId,
        recipientUserIds: maintenanceUsers,
        category: 'action_required',
        eventType: criticalFailure ? 'critical_inspection_defect' : 'inspection_defect',
        title: criticalFailure ? 'Critical inspection defect' : 'Inspection defect requires review',
        body: `${failedItems.length} defect${failedItems.length === 1 ? '' : 's'} recorded during a ${input.type} inspection.`,
        entityType: 'inspection',
        entityId: inspectionId,
        actionUrl: '/dashboard/maintenance',
        workspace: WorkspaceIds.MAINTENANCE,
        priority: criticalFailure ? 'urgent' : 'high',
      });
    } catch (error) {
      console.error('[inspection-service] Maintenance notification failed after commit:', error);
    }
  }

  let document = null;
  try {
    document = await onInspectionCompleted(inspectionId, tenantId, userId);
  } catch (error) {
    console.error('[inspection-service] Document generation failed after commit:', error);
  }

  return {
    inspection,
    trip: updatedTrip,
    document,
    overallPass,
    status,
    idempotent: false,
  };
}
