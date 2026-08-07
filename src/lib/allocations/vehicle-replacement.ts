/**
 * Vehicle Replacement Service
 *
 * Drives the mid-trip (and pre-issue) replacement of the vehicle assigned
 * to a trip allocation. Replacing a vehicle is a multi-table operation:
 *
 *   1. Verify the replacement vehicle belongs to the same tenant and is
 *      eligible (available, not already on an overlapping allocation).
 *   2. Record the replacement on the allocation — the original vehicle is
 *      preserved in `replacedFromVehicleId` so the trip closure can split
 *      odometer readings per vehicle.
 *   3. Repoint the trip's `vehicleId` to the replacement.
 *   4. Transfers outstanding departure inspection item results from the
 *      original to the replacement so a mid-trip swap isn't blocked by an
 *      incomplete checklist.
 *   5. Put the original vehicle back into the pool and mark the replacement
 *      as allocated/issued, each with a vehicle status event.
 *   6. Write a single audit event capturing before/after + odometer handover.
 *
 * The service lives in a transaction so a failure mid-way never leaves the
 * allocation, trip, inspections and vehicle statuses inconsistent.
 */

import { getDb } from '@/db';
import { vehicleAllocations, trips } from '@/db/schema/trips';
import {
  vehicleInspections,
  inspectionItemResults,
} from '@/db/schema/trips';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, ne, inArray, lt, gt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { AuthSession } from '@/lib/auth-helpers';

export interface ReplaceVehicleInput {
  allocationId: string;
  /** The vehicle being moved TO. */
  replacementVehicleId: string;
  reason: string;
  /** Odometer reading of the original vehicle at handover (mid-trip only). */
  handoverOdometer?: number | null;
}

export interface ReplaceVehicleResult {
  success: boolean;
  replacementVehicleId: string;
  originalVehicleId: string;
  handoverOdometer?: number | null;
}

/**
 * States from which a vehicle replacement is permitted.
 * Pre-issue swaps (provisional/confirmed) are routine; an allocated or issued
 * vehicle may also be replaced mid-trip as long as a handover odometer is
 * supplied.
 */
const SWAPPABLE_STATES = ['provisional', 'confirmed', 'allocated', 'issued'];

/**
 * Replace the vehicle assigned to an allocation (and its trip).
 * See the module doc for the full behaviour contract.
 */
export async function replaceVehicle(
  input: ReplaceVehicleInput,
  session: AuthSession,
): Promise<ReplaceVehicleResult> {
  const db = getDb();
  const { allocationId, replacementVehicleId, reason, handoverOdometer } = input;
  const tenantId = session.tenantId;

  if (!replacementVehicleId || !reason.trim()) {
    throw new VehicleReplaceError('Replacement vehicle and reason are required');
  }

  // Read the current allocation (tenant-isolated via join).
  const [allocation] = await db
    .select({
      id: vehicleAllocations.id,
      state: vehicleAllocations.state,
      vehicleId: vehicleAllocations.vehicleId,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      replacedFromVehicleId: vehicleAllocations.replacedFromVehicleId,
    })
    .from(vehicleAllocations)
    .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
    .where(and(eq(vehicleAllocations.id, allocationId), eq(vehicles.tenantId, tenantId)))
    .limit(1);

  if (!allocation) {
    throw new VehicleReplaceError('Allocation not found', 404);
  }

  if (!SWAPPABLE_STATES.includes(allocation.state)) {
    throw new VehicleReplaceError(
      `Vehicle replacement is not allowed from '${allocation.state}' state`,
      409,
    );
  }

  if (replacementVehicleId === allocation.vehicleId) {
    throw new VehicleReplaceError('Replacement vehicle is the same as the current vehicle');
  }

  // Mid-trip (issued/allocated) replacements require the odometer handover.
  const midTrip = allocation.state === 'allocated' || allocation.state === 'issued';
  if (midTrip && (handoverOdometer === null || handoverOdometer === undefined)) {
    throw new VehicleReplaceError('Odometer reading at handover is required for a mid-trip replacement', 409);
  }

  // Verify the replacement vehicle exists, belongs to the tenant, and is eligible.
  const [replacement] = await db
    .select({ id: vehicles.id, status: vehicles.status })
    .from(vehicles)
    .where(and(eq(vehicles.id, replacementVehicleId), eq(vehicles.tenantId, tenantId)))
    .limit(1);
  if (!replacement) {
    throw new VehicleReplaceError('Replacement vehicle not found in this tenant', 404);
  }
  if (!['available', 'provisional', 'allocated'].includes(replacement.status)) {
    throw new VehicleReplaceError(
      `Replacement vehicle is not available (status: ${replacement.status})`,
      409,
    );
  }
  if (replacement.status === 'allocated') {
    throw new VehicleReplaceError('Replacement vehicle is already allocated elsewhere', 409);
  }

  // No overlapping active allocation for the replacement in this period.
  const [conflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .where(
      and(
        eq(vehicleAllocations.vehicleId, replacementVehicleId),
        ne(vehicleAllocations.id, allocation.id),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'allocated', 'issued']),
        lt(vehicleAllocations.startAt, allocation.endAt),
        gt(vehicleAllocations.endAt, allocation.startAt),
      ),
    )
    .limit(1);
  if (conflict) {
    throw new VehicleReplaceError('Replacement vehicle is already allocated during this period', 409);
  }

  const now = new Date();

  try {
    const dbc = getDb();
    const result = await dbc.transaction(async (tx) => {
      const originalVehicleId = allocation.vehicleId;

      // 1. Update the allocation: point to the new vehicle and record the swap.
      await tx
        .update(vehicleAllocations)
        .set({
          vehicleId: replacementVehicleId,
          replacedFromVehicleId: originalVehicleId,
          replacementReason: reason.trim(),
          replacementAt: now,
          updatedAt: now,
          version: sql`${vehicleAllocations.version} + 1`,
        })
        .where(eq(vehicleAllocations.id, allocationId));

      // 2. Repoint the trip (if one exists for this allocation) and remember its id
      //    so departure inspections can be re-associated to the new vehicle.
      const [tripMatch] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(eq(trips.allocationId, allocationId))
        .limit(1);
      if (tripMatch) {
        await tx
          .update(trips)
          .set({ vehicleId: replacementVehicleId, updatedAt: now, version: sql`${trips.version} + 1` })
          .where(eq(trips.id, tripMatch.id));

        // 3. Transfer outstanding departure inspection item results to the
        //    replacement, and move the inspection rows so the checklist follows
        //    the trip's vehicle. Pending item results are copied to the new
        //    vehicle's inspection record so a mid-trip swap isn't blocked by an
        //    incomplete checklist on the original.
        const existingDepartures = await tx
          .select({ id: vehicleInspections.id, templateVersion: vehicleInspections.templateVersion, templateId: vehicleInspections.templateId })
          .from(vehicleInspections)
          .where(
            and(
              eq(vehicleInspections.tripId, tripMatch.id),
              eq(vehicleInspections.type, 'departure'),
            ),
          );
        for (const insp of existingDepartures) {
          const [replacementInspection] = await tx
            .insert(vehicleInspections)
            .values({
              tenantId,
              vehicleId: replacementVehicleId,
              tripId: tripMatch.id,
              templateId: insp.templateId,
              templateVersion: insp.templateVersion,
              type: 'departure',
              status: 'in_progress',
              inspectorUserId: session.user.id,
              clientSyncId: undefined,
            })
            .returning({ id: vehicleInspections.id });
          // Carry pending item results across to the replacement inspection.
          const existingItems = await tx
            .select({
              templateItemId: inspectionItemResults.templateItemId,
              result: inspectionItemResults.result,
              comment: inspectionItemResults.comment,
              defectId: inspectionItemResults.defectId,
            })
            .from(inspectionItemResults)
            .where(
              and(
                eq(inspectionItemResults.inspectionId, insp.id),
                ne(inspectionItemResults.result, 'not_applicable'),
              ),
            );
          if (existingItems.length > 0) {
            await tx
              .insert(inspectionItemResults)
              .values(
                existingItems.map((item) => ({
                  inspectionId: replacementInspection.id,
                  templateItemId: item.templateItemId,
                  result: item.result,
                  comment: item.comment,
                  defectId: item.defectId,
                })),
              );
          }
        }
      }

      // 4. Release the original vehicle back to the pool and mark the replacement.
      await tx
        .update(vehicles)
        .set({ status: 'available', updatedAt: now })
        .where(eq(vehicles.id, originalVehicleId));
      await tx.insert(vehicleStatusEvents).values({
        vehicleId: originalVehicleId,
        previousStatus: 'allocated',
        newStatus: 'available',
        reason: `Vehicle replaced on allocation ${allocationId.slice(0, 8)}...`,
        changedByUserId: session.user.id,
        referenceEntityType: 'allocation',
        referenceEntityId: allocationId,
      });

      await tx
        .update(vehicles)
        .set({ status: 'allocated', updatedAt: now })
        .where(eq(vehicles.id, replacementVehicleId));
      await tx.insert(vehicleStatusEvents).values({
        vehicleId: replacementVehicleId,
        previousStatus: replacement.status,
        newStatus: 'allocated',
        reason: `Replacement for vehicle ${originalVehicleId.slice(0, 8)}...`,
        changedByUserId: session.user.id,
        referenceEntityType: 'allocation',
        referenceEntityId: allocationId,
      });

      // 5. Audit event with before/after + odometer handover.
      await tx.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'allocation_vehicle_replaced',
        actorUserId: session.user.id,
        action: 'replace_vehicle',
        entityType: 'allocation',
        entityId: allocationId,
        summary: `Allocation vehicle replaced: ${originalVehicleId.slice(0, 8)}… → ${replacementVehicleId.slice(0, 8)}…`,
        before: { vehicleId: originalVehicleId, state: allocation.state },
        after: { vehicleId: replacementVehicleId, reason: reason.trim(), handoverOdometer: handoverOdometer ?? null },
      });

      return { originalVehicleId };
    });

    return {
      success: true,
      replacementVehicleId,
      originalVehicleId: result.originalVehicleId,
      handoverOdometer: handoverOdometer ?? null,
    };
  } catch (err) {
    if (err instanceof VehicleReplaceError) throw err;
    throw err;
  }
}

/** Typed error for vehicle replacement failures (maps to HTTP status). */
export class VehicleReplaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VehicleReplaceError';
    this.status = status;
  }
}