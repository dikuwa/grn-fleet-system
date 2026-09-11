import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { trips, vehicleAllocations, vehicleInspections } from '@/db/schema/trips';

export type InspectionScheduleEvent = {
  key: string;
  allocationId: string;
  tripId: string | null;
  type: 'departure' | 'return';
  dueAt: string;
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

  const allocationRows = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationState: vehicleAllocations.state,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      vehicleId: vehicleAllocations.vehicleId,
      tripId: trips.id,
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
    .where(inArray(vehicleAllocations.state, ['provisional', 'confirmed']))
    .orderBy(asc(vehicleAllocations.startAt));

  const tripIds = Array.from(
    new Set(allocationRows.flatMap((row) => (row.tripId ? [row.tripId] : []))),
  );
  const completedRows = tripIds.length
    ? await db
        .select({ tripId: vehicleInspections.tripId, type: vehicleInspections.type })
        .from(vehicleInspections)
        .where(
          and(
            eq(vehicleInspections.tenantId, tenantId),
            inArray(vehicleInspections.tripId, tripIds),
          ),
        )
    : [];
  const completed = new Set(
    completedRows.flatMap((row) => (row.tripId ? [`${row.tripId}:${row.type}`] : [])),
  );

  return allocationRows
    .flatMap<InspectionScheduleEvent>((row) => {
      const events: InspectionScheduleEvent[] = [];
      if (!row.tripId || !completed.has(`${row.tripId}:departure`)) {
        events.push({
          key: `${row.allocationId}:departure`,
          allocationId: row.allocationId,
          tripId: row.tripId ?? null,
          type: 'departure',
          dueAt: row.startAt.toISOString(),
          allocationState: row.allocationState,
          requestReference: row.requestReference,
          vehicleId: row.vehicleId,
          licenceNumber: row.licenceNumber,
          make: row.make,
          model: row.model,
        });
      }
      if (!row.tripId || !completed.has(`${row.tripId}:return`)) {
        events.push({
          key: `${row.allocationId}:return`,
          allocationId: row.allocationId,
          tripId: row.tripId ?? null,
          type: 'return',
          dueAt: row.endAt.toISOString(),
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
