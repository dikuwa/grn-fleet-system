/**
 * Vehicle Replacement Service
 *
 * Replaces the vehicle attached to an allocation/trip without creating a
 * second operational state machine. Allocation state remains confirmed while
 * a trip is live; trip.issuedAt/status determine whether the swap is mid-trip.
 */

import { randomUUID } from 'crypto';
import { getDb } from '@/db';
import {
  vehicleAllocations,
  trips,
  vehicleInspections,
  inspectionItemResults,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, ne, inArray, lt, gt, sql } from 'drizzle-orm';
import type { AuthSession } from '@/lib/auth-helpers';
import { runAtomicMutations } from '@/lib/db-atomic';

export interface ReplaceVehicleInput {
  allocationId: string;
  replacementVehicleId: string;
  reason: string;
  handoverOdometer?: number | null;
}

export interface ReplaceVehicleResult {
  success: boolean;
  replacementVehicleId: string;
  originalVehicleId: string;
  handoverOdometer?: number | null;
}

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;
const MID_TRIP_STATUSES = ['in_progress', 'return_due', 'return_inspection', 'closure_review'];

export async function replaceVehicle(
  input: ReplaceVehicleInput,
  session: AuthSession,
): Promise<ReplaceVehicleResult> {
  const db = getDb();
  const { allocationId, replacementVehicleId, reason, handoverOdometer } = input;
  const tenantId = session.tenantId;
  const cleanReason = reason?.trim();

  if (!replacementVehicleId || !cleanReason) {
    throw new VehicleReplaceError('Replacement vehicle and reason are required');
  }
  if (handoverOdometer != null && (!Number.isInteger(handoverOdometer) || handoverOdometer < 0)) {
    throw new VehicleReplaceError('Handover odometer must be a non-negative whole number');
  }

  const [context] = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationState: vehicleAllocations.state,
      originalVehicleId: vehicleAllocations.vehicleId,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      replacedFromVehicleId: vehicleAllocations.replacedFromVehicleId,
      requestId: vehicleAllocations.requestId,
      tripId: trips.id,
      tripStatus: trips.status,
      issuedAt: trips.issuedAt,
    })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
    .leftJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .where(and(
      eq(vehicleAllocations.id, allocationId),
      eq(transportRequests.tenantId, tenantId),
    ))
    .limit(1);

  if (!context) throw new VehicleReplaceError('Allocation not found', 404);
  if (!LIVE_ALLOCATION_STATES.includes(context.allocationState as typeof LIVE_ALLOCATION_STATES[number])) {
    throw new VehicleReplaceError(
      `Vehicle replacement is not allowed from '${context.allocationState}' allocation state`,
      409,
    );
  }
  if (replacementVehicleId === context.originalVehicleId) {
    throw new VehicleReplaceError('Replacement vehicle is the same as the current vehicle');
  }
  if (context.replacedFromVehicleId) {
    throw new VehicleReplaceError(
      'This allocation already records a vehicle replacement. Use the incident/escalation workflow for an additional swap so vehicle history is not overwritten.',
      409,
    );
  }

  const midTrip = Boolean(
    context.issuedAt ||
    (context.tripStatus && MID_TRIP_STATUSES.includes(context.tripStatus)),
  );
  if (midTrip && handoverOdometer == null) {
    throw new VehicleReplaceError('Odometer reading at handover is required after vehicle issue', 409);
  }

  const [replacement] = await db
    .select({ id: vehicles.id, status: vehicles.status, currentOdometer: vehicles.currentOdometer })
    .from(vehicles)
    .where(and(eq(vehicles.id, replacementVehicleId), eq(vehicles.tenantId, tenantId)))
    .limit(1);
  if (!replacement) throw new VehicleReplaceError('Replacement vehicle not found in this tenant', 404);
  if (replacement.status !== 'available') {
    throw new VehicleReplaceError(`Replacement vehicle is not available (status: ${replacement.status})`, 409);
  }

  const [conflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .where(and(
      eq(vehicleAllocations.vehicleId, replacementVehicleId),
      ne(vehicleAllocations.id, allocationId),
      inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
      lt(vehicleAllocations.startAt, context.endAt),
      gt(vehicleAllocations.endAt, context.startAt),
    ))
    .limit(1);
  if (conflict) {
    throw new VehicleReplaceError('Replacement vehicle is already allocated during this period', 409);
  }

  // Read dependent inspection data before building the non-interactive Neon
  // transaction. IDs are pre-generated so the entire mutation set can still be
  // committed atomically by db.batch().
  const inspectionCopies: Array<{
    id: string;
    templateId: string;
    templateVersion: number;
    items: Array<{
      templateItemId: string;
      result: string;
      comment: string | null;
      defectId: string | null;
    }>;
  }> = [];

  if (context.tripId && !midTrip) {
    const departures = await db
      .select({
        id: vehicleInspections.id,
        templateId: vehicleInspections.templateId,
        templateVersion: vehicleInspections.templateVersion,
        status: vehicleInspections.status,
      })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tripId, context.tripId),
        eq(vehicleInspections.tenantId, tenantId),
        eq(vehicleInspections.type, 'departure'),
      ));

    // Only unfinished departure work follows a pre-issue replacement. A passed
    // inspection belongs to the original vehicle and cannot certify the new one.
    for (const inspection of departures.filter((row) => row.status !== 'completed')) {
      const items = await db
        .select({
          templateItemId: inspectionItemResults.templateItemId,
          result: inspectionItemResults.result,
          comment: inspectionItemResults.comment,
          defectId: inspectionItemResults.defectId,
        })
        .from(inspectionItemResults)
        .where(eq(inspectionItemResults.inspectionId, inspection.id));
      inspectionCopies.push({
        id: randomUUID(),
        templateId: inspection.templateId,
        templateVersion: inspection.templateVersion,
        items,
      });
    }
  }

  const now = new Date();
  await runAtomicMutations((tx) => {
    const mutations: any[] = [
      tx.update(vehicleAllocations)
        .set({
          vehicleId: replacementVehicleId,
          replacedFromVehicleId: context.originalVehicleId,
          replacementReason: cleanReason,
          replacementAt: now,
          updatedAt: now,
          version: sql`${vehicleAllocations.version} + 1`,
        })
        .where(eq(vehicleAllocations.id, allocationId)),
    ];

    if (context.tripId) {
      mutations.push(
        tx.update(trips)
          .set({
            vehicleId: replacementVehicleId,
            updatedAt: now,
            version: sql`${trips.version} + 1`,
          })
          .where(and(eq(trips.id, context.tripId), eq(trips.tenantId, tenantId))),
      );
    }

    for (const copy of inspectionCopies) {
      mutations.push(
        tx.insert(vehicleInspections).values({
          id: copy.id,
          tenantId,
          vehicleId: replacementVehicleId,
          tripId: context.tripId,
          templateId: copy.templateId,
          templateVersion: copy.templateVersion,
          type: 'departure',
          status: 'in_progress',
          inspectorUserId: session.user.id,
        }),
      );
      if (copy.items.length) {
        mutations.push(
          tx.insert(inspectionItemResults).values(copy.items.map((item) => ({
            inspectionId: copy.id,
            templateItemId: item.templateItemId,
            result: item.result,
            comment: item.comment,
            defectId: item.defectId,
          }))),
        );
      }
    }

    if (midTrip) {
      mutations.push(
        tx.update(vehicles)
          .set({ status: 'available', updatedAt: now })
          .where(and(eq(vehicles.id, context.originalVehicleId), eq(vehicles.tenantId, tenantId))),
        tx.insert(vehicleStatusEvents).values({
          vehicleId: context.originalVehicleId,
          previousStatus: 'allocated',
          newStatus: 'available',
          reason: `Vehicle replaced on allocation ${allocationId.slice(0, 8)}...`,
          changedByUserId: session.user.id,
          referenceEntityType: 'allocation',
          referenceEntityId: allocationId,
        }),
        tx.update(vehicles)
          .set({ status: 'allocated', updatedAt: now })
          .where(and(eq(vehicles.id, replacementVehicleId), eq(vehicles.tenantId, tenantId))),
        tx.insert(vehicleStatusEvents).values({
          vehicleId: replacementVehicleId,
          previousStatus: 'available',
          newStatus: 'allocated',
          reason: `Replacement for vehicle ${context.originalVehicleId.slice(0, 8)}...`,
          changedByUserId: session.user.id,
          referenceEntityType: 'allocation',
          referenceEntityId: allocationId,
        }),
      );
    }

    mutations.push(
      tx.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'allocation_vehicle_replaced',
        actorUserId: session.user.id,
        action: 'replace_vehicle',
        entityType: 'allocation',
        entityId: allocationId,
        summary: `Allocation vehicle replaced: ${context.originalVehicleId.slice(0, 8)}… → ${replacementVehicleId.slice(0, 8)}…`,
        before: { vehicleId: context.originalVehicleId, state: context.allocationState },
        after: {
          vehicleId: replacementVehicleId,
          reason: cleanReason,
          handoverOdometer: handoverOdometer ?? null,
          midTrip,
        },
      }),
    );
    return mutations;
  });

  return {
    success: true,
    replacementVehicleId,
    originalVehicleId: context.originalVehicleId,
    handoverOdometer: handoverOdometer ?? null,
  };
}

export class VehicleReplaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VehicleReplaceError';
    this.status = status;
  }
}
