import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import {
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';

export type InspectionScheduleEvent = {
  key: string;
  allocationId: string;
  tripId: string | null;
  type: 'departure' | 'return';
  dueAt: string;
  isOverdue: boolean;
  allocationState: string;
  requestReference: string | null;
  vehicleId: string;
  licenceNumber: string;
  make: string;
  model: string;
};

/**
 * Derive inspection planning from the authoritative allocation window instead
 * of storing a second mutable schedule. Transport Review schedule corrections
 * therefore move the inspection plan automatically.
 */
export async function getPendingInspectionSchedule(
  tenantId: string,
  limit = 100,
): Promise<InspectionScheduleEvent[]> {
  const db = getDb();
  const now = Date.now();

  const allocationRows = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationState: vehicleAllocations.state,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      vehicleId: vehicleAllocations.vehicleId,
      tripId: trips.id,
      authorityAcceptedAt: tripAuthorities.acceptedAt,
      requestReference: transportRequests.reference,
      licenceNumber: vehicles.licenceNumber,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(vehicleAllocations)
    .innerJoin(
      transportRequests,
      and(
        eq(transportRequests.id, vehicleAllocations.requestId),
        eq(transportRequests.tenantId, tenantId),
      ),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, vehicleAllocations.vehicleId), eq(vehicles.tenantId, tenantId)),
    )
    .leftJoin(
      trips,
      and(eq(trips.allocationId, vehicleAllocations.id), eq(trips.tenantId, tenantId)),
    )
    .leftJoin(
      tripAuthorities,
      and(
        eq(tripAuthorities.tripId, trips.id),
        eq(tripAuthorities.allocationId, vehicleAllocations.id),
        eq(tripAuthorities.tenantId, tenantId),
      ),
    )
    .where(inArray(vehicleAllocations.state, ['provisional', 'confirmed']))
    .orderBy(asc(vehicleAllocations.startAt));

  const tripIds = Array.from(
    new Set(allocationRows.flatMap((row) => (row.tripId ? [row.tripId] : []))),
  );
  const inspectionRows = tripIds.length
    ? await db
        .select({
          tripId: vehicleInspections.tripId,
          vehicleId: vehicleInspections.vehicleId,
          type: vehicleInspections.type,
          overallPass: vehicleInspections.overallPass,
          createdAt: vehicleInspections.createdAt,
        })
        .from(vehicleInspections)
        .where(
          and(
            eq(vehicleInspections.tenantId, tenantId),
            inArray(vehicleInspections.tripId, tripIds),
          ),
        )
    : [];

  const inspectionsByTripVehicle = new Map<string, typeof inspectionRows>();
  for (const inspection of inspectionRows) {
    if (!inspection.tripId) continue;
    const key = `${inspection.tripId}:${inspection.vehicleId}`;
    const current = inspectionsByTripVehicle.get(key) ?? [];
    current.push(inspection);
    inspectionsByTripVehicle.set(key, current);
  }

  return allocationRows
    .flatMap<InspectionScheduleEvent>((row) => {
      const events: InspectionScheduleEvent[] = [];
      const currentVehicleInspections = row.tripId
        ? inspectionsByTripVehicle.get(`${row.tripId}:${row.vehicleId}`) ?? []
        : [];

      // Departure work is satisfied only by a passing inspection for the current
      // allocated vehicle that is at least as recent as the driver's latest
      // authority acceptance. Material pre-departure amendments update acceptedAt
      // and reset the authority to awaiting_pre_trip_inspection, so an older pass
      // must not hide the required fresh inspection. Failed departures also remain
      // scheduled until a later passing re-inspection exists.
      const departureSatisfied = currentVehicleInspections.some(
        (inspection) =>
          inspection.type === 'departure' &&
          inspection.overallPass === true &&
          (!row.authorityAcceptedAt || inspection.createdAt >= row.authorityAcceptedAt),
      );

      // Return inspection is complete once performed for the current vehicle.
      // The return lifecycle advances to closure review even when defects are
      // recorded for maintenance follow-up.
      const returnSatisfied = currentVehicleInspections.some(
        (inspection) => inspection.type === 'return',
      );

      if (!row.tripId || !departureSatisfied) {
        events.push({
          key: `${row.allocationId}:departure`,
          allocationId: row.allocationId,
          tripId: row.tripId ?? null,
          type: 'departure',
          dueAt: row.startAt.toISOString(),
          isOverdue: row.startAt.getTime() < now,
          allocationState: row.allocationState,
          requestReference: row.requestReference,
          vehicleId: row.vehicleId,
          licenceNumber: row.licenceNumber,
          make: row.make,
          model: row.model,
        });
      }
      if (!row.tripId || !returnSatisfied) {
        events.push({
          key: `${row.allocationId}:return`,
          allocationId: row.allocationId,
          tripId: row.tripId ?? null,
          type: 'return',
          dueAt: row.endAt.toISOString(),
          isOverdue: row.endAt.getTime() < now,
          allocationState: row.allocationState,
          requestReference: row.requestReference,
          vehicleId: row.vehicleId,
          licenceNumber: row.licenceNumber,
          make: row.make,
          model: row.model,
        });
      }
      return events;
    })
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
    .slice(0, Math.max(1, limit));
}
