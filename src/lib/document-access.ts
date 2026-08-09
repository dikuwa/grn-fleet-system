import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import type { AuthSession } from '@/lib/auth-helpers';
import { getSessionWorkspace } from '@/lib/auth-helpers';
import { WorkspaceIds } from '@/lib/workspaces';
import { transportRequests, requestPassengers } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { trips, vehicleAllocations, vehicleInspections } from '@/db/schema/trips';

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
      ),
    )
    .limit(1);
  return Boolean(participant);
}

/**
 * Apply record scope to generated documents.
 *
 * Operational/admin workspaces retain their existing tenant-scoped FILE_VIEW
 * behaviour. The Personal workspace is intentionally narrower: a user may
 * read only documents whose underlying request belongs to them (or names them
 * as an employee passenger). This closes same-tenant ID guessing without
 * breaking Transport Administration, inspection or audit workflows.
 */
export async function canSessionReadGeneratedDocument(
  session: AuthSession,
  document: GeneratedDocumentRef,
): Promise<boolean> {
  const { activeWorkspace } = await getSessionWorkspace(session);
  if (activeWorkspace !== WorkspaceIds.PERSONAL) return true;

  if (document.generatedByUserId === session.user.id) return true;

  const db = getDb();
  switch (document.entityType) {
    case 'transport_request':
      return canReadRequest(session, document.entityId);

    case 'trip': {
      const [trip] = await db
        .select({ requestId: trips.requestId })
        .from(trips)
        .where(and(eq(trips.id, document.entityId), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      return trip ? canReadRequest(session, trip.requestId) : false;
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
      return allocation ? canReadRequest(session, allocation.requestId) : false;
    }

    case 'inspection': {
      const [inspection] = await db
        .select({ tripId: vehicleInspections.tripId })
        .from(vehicleInspections)
        .where(
          and(
            eq(vehicleInspections.id, document.entityId),
            eq(vehicleInspections.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (!inspection?.tripId) return false;
      const [trip] = await db
        .select({ requestId: trips.requestId })
        .from(trips)
        .where(and(eq(trips.id, inspection.tripId), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      return trip ? canReadRequest(session, trip.requestId) : false;
    }

    default:
      // Personal users never receive arbitrary fleet/audit/maintenance reports.
      return false;
  }
}
