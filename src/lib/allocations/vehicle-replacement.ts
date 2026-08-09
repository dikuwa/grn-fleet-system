import { randomUUID } from 'crypto';
import { getDb } from '@/db';
import {
  tripAmendments,
  tripAuthorities,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
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
      authorityId: tripAuthorities.id,
      authorityVersion: tripAuthorities.version,
      authorityData: tripAuthorities.data,
      authorityStatus: tripAuthorities.status,
    })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
    .leftJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .leftJoin(tripAuthorities, eq(tripAuthorities.allocationId, vehicleAllocations.id))
    .where(and(
      eq(vehicleAllocations.id, allocationId),
      eq(transportRequests.tenantId, tenantId),
    ))
    .limit(1);

  if (!context) throw new VehicleReplaceError('Allocation not found', 404);
  if (!LIVE_ALLOCATION_STATES.includes(context.allocationState as (typeof LIVE_ALLOCATION_STATES)[number])) {
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
      'This allocation already records a vehicle replacement. Use the incident/escalation workflow for another swap so vehicle history is not overwritten.',
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
    .select({
      id: vehicles.id,
      status: vehicles.status,
      currentOdometer: vehicles.currentOdometer,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
      colour: vehicles.colour,
      fuelType: vehicles.fuelType,
      seatedCapacity: vehicles.seatedCapacity,
      licenceExpiryDate: vehicles.licenceExpiryDate,
    })
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

  const originalAuthorityData = (context.authorityData ?? {}) as Record<string, unknown>;
  const replacementSnapshot = {
    id: replacement.id,
    registration: replacement.licenceNumber,
    registerNumber: replacement.vehicleRegisterNumber,
    make: replacement.make,
    model: replacement.model,
    colour: replacement.colour,
    fuelType: replacement.fuelType,
    seatedCapacity: replacement.seatedCapacity,
    licenceExpiryDate: replacement.licenceExpiryDate,
  };
  const nextAuthorityData = context.authorityId
    ? { ...originalAuthorityData, vehicle: replacementSnapshot }
    : null;
  const amendmentId = context.authorityId ? randomUUID() : null;
  const now = new Date();

  await runAtomicMutations((tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    if (context.authorityId && nextAuthorityData && amendmentId) {
      mutations.push(
        tx.insert(tripAmendments).values({
          id: amendmentId,
          authorityId: context.authorityId,
          amendmentType: 'vehicle_replacement',
          originalValue: { vehicleId: context.originalVehicleId, vehicle: originalAuthorityData.vehicle ?? null },
          newValue: { vehicleId: replacementVehicleId, vehicle: replacementSnapshot, handoverOdometer: handoverOdometer ?? null },
          reason: cleanReason,
          status: 'approved',
          requestedByUserId: session.user.id,
          approvedByUserId: session.user.id,
          approvedAt: now,
          version: (context.authorityVersion ?? 1) + 1,
        }),
        tx.update(tripAuthorities)
          .set({
            data: nextAuthorityData,
            version: sql`${tripAuthorities.version} + 1`,
            documentVersion: sql`${tripAuthorities.documentVersion} + 1`,
            updatedAt: now,
          })
          .where(and(eq(tripAuthorities.id, context.authorityId), eq(tripAuthorities.tenantId, tenantId))),
      );
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
          authorityAmendmentId: amendmentId,
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
