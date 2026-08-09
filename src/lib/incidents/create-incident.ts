/**
 * Production-safe incident creation service.
 *
 * Neon HTTP does not support interactive Drizzle transactions. The tenant
 * incident number is therefore reserved with one atomic upsert, then the
 * incident, audit event and any critical-vehicle side effects are committed
 * together through runAtomicMutations(), which uses db.batch() on Neon and an
 * interactive transaction for local PostgreSQL.
 *
 * A failed mutation batch may consume a reserved sequence number, but it can
 * never leave a partially-created incident or partially-restricted vehicle.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '@/db';
import {
  tripIncidentSequences,
  tripIncidents,
  trips,
} from '@/db/schema/trips';
import {
  vehicles,
  vehicleStatusEvents,
  vehicleDefects,
  maintenanceEvents,
} from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { generateDocument } from '@/lib/document-generator';
import { runAtomicMutations } from '@/lib/db-atomic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateIncidentInput = {
  tripId: string;
  clientSyncId?: string | null;
  incidentType: string;
  incidentCategoryCode?: string | null;
  requiresMvaForm?: boolean;
  severity: 'minor' | 'moderate' | 'serious' | 'critical';
  occurredAt: Date;
  location?: string | null;
  odometerReading?: number | null;
  description: string;
  injuries: boolean;
  vehicleDamage: boolean;
  thirdPartyInvolvement: boolean;
  policeReference?: string | null;
  emergencyServicesContacted: boolean;
  safeToContinue: boolean;
  continuationState: string;
  actionTaken?: string | null;
  attachmentKeys: string[];
  attachmentHashes?: Record<string, string>;
  reportedByUserId: string;
  tenantId: string;
};

export type CreateIncidentResult = {
  incident: typeof tripIncidents.$inferSelect;
  officialNumber: string;
  idempotent?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMvaType(type: string): boolean {
  return ['accident', 'accident_collision'].includes(type);
}

/** Determine whether this incident should generate an MVAR based on category or severity. */
export function requiresMvaForm(
  input: Pick<CreateIncidentInput, 'incidentCategoryCode' | 'requiresMvaForm' | 'incidentType' | 'severity'>,
): boolean {
  if (input.requiresMvaForm) return true;
  if (input.incidentCategoryCode && MVA_CATEGORY_CODES.has(input.incidentCategoryCode)) return true;
  return isMvaType(input.incidentType) && isMvaSeverity(input.severity);
}

/** Category codes that inherently require a full Motor Vehicle Accident Report. */
const MVA_CATEGORY_CODES = new Set<string>([
  'accident',
  'accident_collision',
  'passenger_injury',
  'driver_injury',
  'third_party_injury',
  'third_party_vehicle_damage',
  'property_damage',
]);

function isMvaSeverity(severity: string): boolean {
  return ['serious', 'critical'].includes(severity);
}

async function deliverIncidentSideEffects(
  input: CreateIncidentInput,
  incident: typeof tripIncidents.$inferSelect,
  officialNumber: string,
) {
  const documentType = requiresMvaForm(input) ? 'accident_report' : 'trip_incident_report';

  // Await best-effort external work so serverless runtimes do not terminate
  // before notifications/documents have had a chance to persist.
  await Promise.allSettled([
    createScopedNotifications({
      tenantId: input.tenantId,
      recipientUserIds: [input.reportedByUserId],
      category: 'outcome',
      eventType: 'incident_reported',
      title: `${officialNumber} — ${input.incidentType.replace(/_/g, ' ')}`,
      body: `${input.description.slice(0, 200)}. Trip: ${input.tripId.slice(0, 8)}.`,
      entityType: 'trip_incident',
      entityId: incident.id,
      actionUrl: `/dashboard/trips/${input.tripId}`,
      workspace: WorkspaceIds.DRIVER,
      priority: 'high',
    }),
    resolveActiveRoleRecipients(input.tenantId, [SystemRoles.TRANSPORT_ADMIN]).then((admins) =>
      createScopedNotifications({
        tenantId: input.tenantId,
        recipientUserIds: admins,
        category: 'action_required',
        eventType: 'trip_incident_review',
        title: `${officialNumber} requires operational review`,
        body: input.description.slice(0, 200),
        entityType: 'trip_incident',
        entityId: incident.id,
        actionUrl: `/dashboard/trips/${input.tripId}`,
        workspace: WorkspaceIds.TRANSPORT_ADMIN,
        priority: input.severity === 'critical' ? 'emergency' : 'high',
      }),
    ),
    generateDocument({
      documentType,
      entityType: 'trip_incident',
      entityId: incident.id,
      tenantId: input.tenantId,
      generatedByUserId: input.reportedByUserId,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Create an incident with production-safe atomic mutations.
 *
 * Critical incidents atomically:
 *  - create the incident and audit event
 *  - move the allocated vehicle to maintenance
 *  - record a vehicle status event
 *  - create a blocking defect
 *  - create a maintenance follow-up
 */
export async function createIncident(
  input: CreateIncidentInput,
): Promise<CreateIncidentResult> {
  const db = getDb();

  if (input.clientSyncId) {
    const [existing] = await db
      .select()
      .from(tripIncidents)
      .where(
        and(
          eq(tripIncidents.tenantId, input.tenantId),
          eq(tripIncidents.clientSyncId, input.clientSyncId),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        incident: existing,
        officialNumber: existing.officialNumber || existing.id,
        idempotent: true,
      };
    }
  }

  // Validate the tenant trip and capture the current vehicle status before
  // reserving a number or constructing the atomic mutation batch.
  const [trip] = await db
    .select({
      id: trips.id,
      vehicleId: trips.vehicleId,
      vehicleStatus: vehicles.status,
    })
    .from(trips)
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
    .limit(1);
  if (!trip) throw new Error('Trip not found in your organisation');

  const year = input.occurredAt.getUTCFullYear();
  const [sequence] = await db
    .insert(tripIncidentSequences)
    .values({
      tenantId: input.tenantId,
      sequenceYear: year,
      currentValue: 1,
    })
    .onConflictDoUpdate({
      target: [tripIncidentSequences.tenantId, tripIncidentSequences.sequenceYear],
      set: {
        currentValue: sql`${tripIncidentSequences.currentValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ currentValue: tripIncidentSequences.currentValue });

  const officialNumber =
    `${isMvaType(input.incidentType) && isMvaSeverity(input.severity) ? 'ACC' : 'TID'}-${year}-${String(sequence.currentValue).padStart(5, '0')}`;
  const incidentId = randomUUID();
  const needsMvaDetails = requiresMvaForm(input);
  const sourceChannel = input.clientSyncId ? 'offline_sync' : 'web';
  const serviceDate = new Date().toISOString().split('T')[0];

  try {
    await runAtomicMutations((tx) => {
      const mutations = [
        tx.insert(tripIncidents).values({
          id: incidentId,
          tenantId: input.tenantId,
          tripId: input.tripId,
          clientSyncId: input.clientSyncId || null,
          officialNumber,
          incidentType: input.incidentType,
          incidentCategoryCode: input.incidentCategoryCode || null,
          severity: input.severity,
          occurredAt: input.occurredAt,
          location: input.location || null,
          odometerReading: input.odometerReading ? Number(input.odometerReading) : null,
          description: input.description,
          injuries: input.injuries,
          vehicleDamage: input.vehicleDamage,
          thirdPartyInvolvement: input.thirdPartyInvolvement,
          policeReference: input.policeReference || null,
          emergencyServicesContacted: input.emergencyServicesContacted,
          safeToContinue: input.safeToContinue,
          continuationState: input.continuationState,
          vehicleSafe: input.safeToContinue,
          passengerSafe: !input.injuries,
          numberInjured: input.injuries ? 1 : 0,
          detailsRequired: needsMvaDetails,
          actionTaken: input.actionTaken || null,
          attachmentKeys: input.attachmentKeys || [],
          attachmentHashes: input.attachmentHashes || {},
          status: 'reported',
          reportedByUserId: input.reportedByUserId,
          offlineCreatedAt: input.clientSyncId ? input.occurredAt : null,
        }),
        tx.insert(auditEvents).values({
          tenantId: input.tenantId,
          tenantSequence: Date.now(),
          eventType: 'incident_created',
          actorUserId: input.reportedByUserId,
          action: 'create',
          entityType: 'trip_incident',
          entityId: incidentId,
          summary:
            `${officialNumber}: ${input.incidentType} (${input.severity}) — ${input.description.slice(0, 120)}${input.description.length > 120 ? '...' : ''}`,
          sourceChannel,
          after: {
            tripId: input.tripId,
            severity: input.severity,
            continuationState: input.continuationState,
            detailsRequired: needsMvaDetails,
          },
        }),
      ];

      if (input.severity === 'critical' && trip.vehicleId) {
        mutations.push(
          tx
            .update(vehicles)
            .set({ status: 'maintenance', updatedAt: new Date() })
            .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, input.tenantId))),
          tx.insert(vehicleStatusEvents).values({
            vehicleId: trip.vehicleId,
            previousStatus: trip.vehicleStatus,
            newStatus: 'maintenance',
            reason: `Critical incident ${officialNumber} — vehicle restricted`,
            changedByUserId: input.reportedByUserId,
            referenceEntityType: 'trip_incident',
            referenceEntityId: incidentId,
          }),
          tx.insert(vehicleDefects).values({
            vehicleId: trip.vehicleId,
            tripId: input.tripId,
            severity: 'critical',
            description: `Critical incident ${officialNumber}: ${input.description.slice(0, 200)}`,
            isBlocking: true,
            reportedByUserId: input.reportedByUserId,
          }),
          tx.insert(maintenanceEvents).values({
            vehicleId: trip.vehicleId,
            serviceDate,
            serviceOdometer: input.odometerReading ? Number(input.odometerReading) : null,
            serviceType: 'repair',
            description: `Follow-up from critical incident ${officialNumber}. Vehicle must be inspected and cleared before returning to service.`,
            createdByUserId: input.reportedByUserId,
          }),
        );
      }

      return mutations;
    });
  } catch (error) {
    // Concurrent offline retries are collapsed by the existing unique tenant +
    // clientSyncId index. Return the winning record instead of surfacing 500.
    if (input.clientSyncId && (error as { code?: string }).code === '23505') {
      const [existing] = await db
        .select()
        .from(tripIncidents)
        .where(
          and(
            eq(tripIncidents.tenantId, input.tenantId),
            eq(tripIncidents.clientSyncId, input.clientSyncId),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          incident: existing,
          officialNumber: existing.officialNumber || existing.id,
          idempotent: true,
        };
      }
    }
    throw error;
  }

  const [incident] = await db
    .select()
    .from(tripIncidents)
    .where(and(eq(tripIncidents.id, incidentId), eq(tripIncidents.tenantId, input.tenantId)))
    .limit(1);
  if (!incident) throw new Error('Incident was committed but could not be reloaded');

  await deliverIncidentSideEffects(input, incident, officialNumber);

  return { incident, officialNumber };
}
