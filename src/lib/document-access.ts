import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { getDb } from '@/db';
import type { AuthSession } from '@/lib/auth-helpers';
import { getSessionWorkspace } from '@/lib/auth-helpers';
import { WorkspaceIds } from '@/lib/workspaces';
import {
  transportRequests,
  requestDrivers,
  requestPassengers,
} from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import {
  tripAuthorities,
  tripIncidents,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';

export type GeneratedDocumentRef = {
  entityType: string;
  entityId: string;
  generatedByUserId: string;
};

async function canReadRequest(session: AuthSession, requestId: string): Promise<boolean> {
  const db = getDb();
  const [direct] = await db
    .select({ id: transportRequests.id })
    .from(transportRequests)
    .where(
      and(
        eq(transportRequests.id, requestId),
        eq(transportRequests.tenantId, session.tenantId),
        or(
          eq(transportRequests.requesterUserId, session.user.id),
          eq(transportRequests.enteredByUserId, session.user.id),
        )!,
      ),
    )
    .limit(1);
  if (direct) return true;

  const [participant] = await db
    .select({ id: requestPassengers.id })
    .from(requestPassengers)
    .innerJoin(employees, eq(requestPassengers.employeeId, employees.id))
    .innerJoin(transportRequests, eq(requestPassengers.requestId, transportRequests.id))
    .where(
      and(
        eq(requestPassengers.requestId, requestId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.userId, session.user.id),
        ne(requestPassengers.status, 'removed'),
      ),
    )
    .limit(1);
  return Boolean(participant);
}

async function canDriverReadRequest(session: AuthSession, requestId: string): Promise<boolean> {
  const db = getDb();

  const [directAssignment] = await db
    .select({ id: transportRequests.id })
    .from(transportRequests)
    .innerJoin(employees, eq(employees.id, transportRequests.assignedDriverEmployeeId))
    .where(
      and(
        eq(transportRequests.id, requestId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.userId, session.user.id),
      ),
    )
    .limit(1);
  if (directAssignment) return true;

  const [driverAssignment] = await db
    .select({ id: requestDrivers.id })
    .from(requestDrivers)
    .innerJoin(employees, eq(employees.id, requestDrivers.employeeId))
    .innerJoin(transportRequests, eq(transportRequests.id, requestDrivers.requestId))
    .where(
      and(
        eq(requestDrivers.requestId, requestId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.userId, session.user.id),
        inArray(requestDrivers.driverType, ['assigned', 'additional']),
      ),
    )
    .limit(1);

  return Boolean(driverAssignment);
}

async function resolveRequestIdForDocument(
  session: AuthSession,
  document: GeneratedDocumentRef,
): Promise<string | null> {
  const db = getDb();

  switch (document.entityType) {
    case 'transport_request': {
      const [request] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(
          and(
            eq(transportRequests.id, document.entityId),
            eq(transportRequests.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      return request?.id ?? null;
    }

    case 'trip': {
      const [trip] = await db
        .select({ requestId: trips.requestId })
        .from(trips)
        .where(and(eq(trips.id, document.entityId), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      return trip?.requestId ?? null;
    }

    case 'vehicle_allocation': {
      const [allocation] = await db
        .select({ requestId: vehicleAllocations.requestId })
        .from(vehicleAllocations)
        .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
        .where(
          and(
            eq(vehicleAllocations.id, document.entityId),
            eq(transportRequests.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      return allocation?.requestId ?? null;
    }

    case 'inspection': {
      const [inspection] = await db
        .select({ requestId: trips.requestId })
        .from(vehicleInspections)
        .innerJoin(trips, eq(trips.id, vehicleInspections.tripId))
        .where(
          and(
            eq(vehicleInspections.id, document.entityId),
            eq(vehicleInspections.tenantId, session.tenantId),
            eq(trips.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      return inspection?.requestId ?? null;
    }

    case 'trip_incident': {
      const [incident] = await db
        .select({ requestId: trips.requestId })
        .from(tripIncidents)
        .innerJoin(trips, eq(trips.id, tripIncidents.tripId))
        .where(
          and(
            eq(tripIncidents.id, document.entityId),
            eq(tripIncidents.tenantId, session.tenantId),
            eq(trips.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      return incident?.requestId ?? null;
    }

    case 'trip_authority': {
      const [authority] = await db
        .select({ requestId: tripAuthorities.requestId })
        .from(tripAuthorities)
        .where(
          and(
            eq(tripAuthorities.id, document.entityId),
            eq(tripAuthorities.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      return authority?.requestId ?? null;
    }

    default:
      return null;
  }
}

/**
 * Apply the same canonical workspace record scope used by the Documents route
 * to direct detail/PDF access. Tenant isolation alone is not sufficient:
 * Driver sees assigned trip documents only; Personal sees owned/participating
 * request documents; Transport Administration and Audit retain tenant-wide
 * document registers. Other workspaces cannot bypass their route registry by
 * guessing a generated-document id.
 */
export async function canSessionReadGeneratedDocument(
  session: AuthSession,
  document: GeneratedDocumentRef,
): Promise<boolean> {
  const { activeWorkspace } = await getSessionWorkspace(session);

  if (
    activeWorkspace === WorkspaceIds.TRANSPORT_ADMIN ||
    activeWorkspace === WorkspaceIds.AUDIT
  ) {
    return true;
  }

  const requestId = await resolveRequestIdForDocument(session, document);
  if (!requestId) return false;

  if (activeWorkspace === WorkspaceIds.DRIVER) {
    return canDriverReadRequest(session, requestId);
  }

  if (activeWorkspace === WorkspaceIds.PERSONAL) {
    return canReadRequest(session, requestId);
  }

  return false;
}
