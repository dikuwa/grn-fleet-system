/**
 * Production-safe incident creation service shared by Driver Console and API routes.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '@/db';
import { tripAuthorities, tripIncidentSequences, tripIncidents, trips } from '@/db/schema/trips';
import { vehicles, vehicleStatusEvents, vehicleDefects, maintenanceEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { generateDocument } from '@/lib/document-generator';
import { runAtomicMutations } from '@/lib/db-atomic';
import {
  incidentRequiresVehicleRestriction,
  normalizedVehicleSafety,
} from '@/lib/incidents/incident-safety';

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
  vehicleSafe?: boolean | null;
  passengerSafe?: boolean | null;
  numberInjured?: number;
  detailsRequired?: boolean;
  dailyLogEntryId?: string | null;
  journeyLegReference?: string | null;
  origin?: string | null;
  destination?: string | null;
  weather?: string | null;
  roadCondition?: string | null;
  thirdPartyDetails?: Record<string, unknown> | null;
  notificationState?: Record<string, unknown> | null;
  actionTaken?: string | null;
  attachmentKeys: string[];
  attachmentHashes?: Record<string, string>;
  offlineCreatedAt?: Date | null;
  reportedByUserId: string;
  tenantId: string;
};

export type CreateIncidentResult = {
  incident: typeof tripIncidents.$inferSelect;
  officialNumber: string;
  idempotent?: boolean;
};

function isMvaType(type: string): boolean {
  return ['accident', 'accident_collision'].includes(type);
}

const MVA_CATEGORY_CODES = new Set([
  'accident',
  'accident_collision',
  'passenger_injury',
  'driver_injury',
  'third_party_injury',
  'third_party_vehicle_damage',
  'property_damage',
]);

const STRONGER_VEHICLE_STATUSES = new Set(['out_of_service', 'written_off', 'decommissioned']);

function isMvaSeverity(severity: string): boolean {
  return ['serious', 'critical'].includes(severity);
}

export function requiresMvaForm(
  input: Pick<CreateIncidentInput, 'incidentCategoryCode' | 'requiresMvaForm' | 'incidentType' | 'severity'>,
): boolean {
  if (input.requiresMvaForm) return true;
  if (input.incidentCategoryCode && MVA_CATEGORY_CODES.has(input.incidentCategoryCode)) return true;
  return isMvaType(input.incidentType) && isMvaSeverity(input.severity);
}

async function deliverIncidentSideEffects(
  input: CreateIncidentInput,
  incident: typeof tripIncidents.$inferSelect,
  officialNumber: string,
  maintenanceAssigneeUserId: string | null,
  tripStatus: string,
  vehicleRestricted: boolean,
) {
  const documentType = requiresMvaForm(input) ? 'accident_report' : 'trip_incident_report';
  const effects: Promise<unknown>[] = [
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
      workspace: null,
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
        priority: input.severity === 'critical' || vehicleRestricted ? 'emergency' : 'high',
      }),
    ),
    generateDocument({
      documentType,
      entityType: 'trip_incident',
      entityId: incident.id,
      tenantId: input.tenantId,
      generatedByUserId: input.reportedByUserId,
    }),
  ];

  if (tripStatus === 'closed') {
    effects.push(
      generateDocument({
        documentType: 'trip_completion',
        entityType: 'trip',
        entityId: input.tripId,
        tenantId: input.tenantId,
        generatedByUserId: input.reportedByUserId,
      }),
    );
  }

  if (vehicleRestricted && maintenanceAssigneeUserId) {
    effects.push(createScopedNotifications({
      tenantId: input.tenantId,
      recipientUserIds: [maintenanceAssigneeUserId],
      category: 'action_required',
      eventType: input.severity === 'critical' ? 'critical_incident_maintenance' : 'unsafe_vehicle_maintenance',
      title: `${officialNumber} requires maintenance review`,
      body: `${input.description.slice(0, 180)}. Resolve the assigned blocking defect; operational technical clearance remains a separate review step before the vehicle can return to service.`,
      entityType: 'trip_incident',
      entityId: incident.id,
      actionUrl: '/dashboard/fleet/defects?status=open',
      workspace: WorkspaceIds.MAINTENANCE,
      priority: input.severity === 'critical' ? 'emergency' : 'high',
    }));
  }

  await Promise.allSettled(effects);
}

export async function createIncident(input: CreateIncidentInput): Promise<CreateIncidentResult> {
  const db = getDb();
  const syncId = input.clientSyncId?.trim() || null;

  if (syncId) {
    const [existing] = await db
      .select()
      .from(tripIncidents)
      .where(and(
        eq(tripIncidents.tenantId, input.tenantId),
        eq(tripIncidents.tripId, input.tripId),
        eq(tripIncidents.clientSyncId, syncId),
        eq(tripIncidents.reportedByUserId, input.reportedByUserId),
      ))
      .limit(1);
    if (existing) {
      return { incident: existing, officialNumber: existing.officialNumber || existing.id, idempotent: true };
    }
  }

  const [trip] = await db
    .select({
      id: trips.id,
      status: trips.status,
      vehicleId: trips.vehicleId,
      vehicleStatus: vehicles.status,
    })
    .from(trips)
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
    .limit(1);
  if (!trip) throw new Error('Trip not found in your organisation');

  const vehicleSafe = normalizedVehicleSafety(input.vehicleSafe);
  const requiresVehicleRestriction = incidentRequiresVehicleRestriction({
    severity: input.severity,
    vehicleDamage: input.vehicleDamage,
    vehicleSafe,
  });
  const restrictedVehicleStatus = STRONGER_VEHICLE_STATUSES.has(trip.vehicleStatus)
    ? trip.vehicleStatus
    : 'maintenance';
  const maintenanceUsers = requiresVehicleRestriction
    ? await resolveActiveRoleRecipients(input.tenantId, [SystemRoles.MAINTENANCE])
    : [];
  const maintenanceAssigneeUserId = maintenanceUsers[0] ?? null;

  const year = input.occurredAt.getUTCFullYear();
  const [sequence] = await db
    .insert(tripIncidentSequences)
    .values({ tenantId: input.tenantId, sequenceYear: year, currentValue: 1 })
    .onConflictDoUpdate({
      target: [tripIncidentSequences.tenantId, tripIncidentSequences.sequenceYear],
      set: { currentValue: sql`${tripIncidentSequences.currentValue} + 1`, updatedAt: new Date() },
    })
    .returning({ currentValue: tripIncidentSequences.currentValue });

  const officialNumber = `${isMvaType(input.incidentType) && isMvaSeverity(input.severity) ? 'ACC' : 'TID'}-${year}-${String(sequence.currentValue).padStart(5, '0')}`;
  const incidentId = randomUUID();
  const needsMvaDetails = input.detailsRequired === true || requiresMvaForm(input);
  const sourceChannel = syncId ? 'offline_sync' : 'web';
  const serviceDate = input.occurredAt.toISOString().split('T')[0];
  const numberInjured = input.injuries ? Math.max(1, input.numberInjured || 1) : 0;
  const invalidateReturnReconciliation = Boolean(
    syncId &&
      input.offlineCreatedAt &&
      ['return_inspection', 'closure_review'].includes(trip.status),
  );

  try {
    await runAtomicMutations((tx) => {
      const mutations = [
        tx.insert(tripIncidents).values({
          id: incidentId,
          tenantId: input.tenantId,
          tripId: input.tripId,
          clientSyncId: syncId,
          officialNumber,
          incidentType: input.incidentType,
          incidentCategoryCode: input.incidentCategoryCode || null,
          severity: input.severity,
          occurredAt: input.occurredAt,
          location: input.location || null,
          odometerReading: input.odometerReading ?? null,
          description: input.description,
          injuries: input.injuries,
          vehicleDamage: input.vehicleDamage,
          thirdPartyInvolvement: input.thirdPartyInvolvement,
          policeReference: input.policeReference || null,
          emergencyServicesContacted: input.emergencyServicesContacted,
          safeToContinue: input.safeToContinue,
          continuationState: input.continuationState,
          vehicleSafe,
          passengerSafe: input.passengerSafe ?? !input.injuries,
          numberInjured,
          detailsRequired: needsMvaDetails,
          dailyLogEntryId: input.dailyLogEntryId || null,
          journeyLegReference: input.journeyLegReference || null,
          origin: input.origin || null,
          destination: input.destination || null,
          weather: input.weather || null,
          roadCondition: input.roadCondition || null,
          thirdPartyDetails: input.thirdPartyDetails || null,
          notificationState: input.notificationState || null,
          actionTaken: input.actionTaken || null,
          attachmentKeys: input.attachmentKeys || [],
          attachmentHashes: input.attachmentHashes || {},
          status: 'reported',
          reportedByUserId: input.reportedByUserId,
          offlineCreatedAt: input.offlineCreatedAt || (syncId ? input.occurredAt : null),
        }),
        tx.insert(auditEvents).values({
          tenantId: input.tenantId,
          tenantSequence: Date.now(),
          eventType: 'incident_created',
          actorUserId: input.reportedByUserId,
          action: 'create',
          entityType: 'trip_incident',
          entityId: incidentId,
          summary: `${officialNumber}: ${input.incidentType} (${input.severity}) — ${input.description.slice(0, 120)}${input.description.length > 120 ? '...' : ''}`,
          sourceChannel,
          after: {
            tripId: input.tripId,
            severity: input.severity,
            vehicleDamage: input.vehicleDamage,
            vehicleSafe,
            safeToContinue: input.safeToContinue,
            continuationState: input.continuationState,
            detailsRequired: needsMvaDetails,
            maintenanceAssigneeUserId,
            journeyHeldForCriticalIncident: input.severity === 'critical',
            vehicleRestricted: requiresVehicleRestriction,
            returnReconciliationInvalidated: invalidateReturnReconciliation,
          },
        }),
      ];

      if (invalidateReturnReconciliation) {
        mutations.push(
          tx
            .update(tripAuthorities)
            .set({
              data: sql`coalesce(${tripAuthorities.data}, '{}'::jsonb) || jsonb_build_object(
                'returnDeclaration',
                coalesce(${tripAuthorities.data}->'returnDeclaration', '{}'::jsonb) || jsonb_build_object(
                  'reconciledAt', null,
                  'lateIncidentRequiresReconciliation', true,
                  'lateIncidentId', ${incidentId},
                  'lateIncidentSyncId', ${syncId}
                )
              )`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(tripAuthorities.tripId, input.tripId),
                eq(tripAuthorities.tenantId, input.tenantId),
              ),
            ),
        );
      }

      if (requiresVehicleRestriction) {
        mutations.push(
          tx
            .update(tripAuthorities)
            .set({ status: 'incident_reported', version: sql`${tripAuthorities.version} + 1`, updatedAt: new Date() })
            .where(and(
              eq(tripAuthorities.tripId, input.tripId),
              eq(tripAuthorities.tenantId, input.tenantId),
              inArray(tripAuthorities.status, ['in_progress', 'delayed', 'route_deviation_pending_review']),
            )),
          tx
            .update(vehicles)
            .set({ status: restrictedVehicleStatus, updatedAt: new Date() })
            .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, input.tenantId))),
          tx.insert(vehicleDefects).values({
            vehicleId: trip.vehicleId,
            tripId: input.tripId,
            severity: input.severity === 'critical' ? 'critical' : 'major',
            description: `${input.severity === 'critical' ? 'Critical incident' : 'Vehicle safety incident'} ${officialNumber}: ${input.description.slice(0, 200)}`,
            isBlocking: true,
            reportedByUserId: input.reportedByUserId,
            assignedToUserId: maintenanceAssigneeUserId,
          }),
          tx.insert(maintenanceEvents).values({
            vehicleId: trip.vehicleId,
            serviceDate,
            serviceOdometer: input.odometerReading ?? null,
            serviceType: 'repair',
            description: `Follow-up from ${input.severity === 'critical' ? 'critical' : 'vehicle-safety'} incident ${officialNumber}. Vehicle must be inspected and cleared before returning to service.`,
            createdByUserId: input.reportedByUserId,
            assignedToUserId: maintenanceAssigneeUserId,
          }),
        );

        if (trip.vehicleStatus !== restrictedVehicleStatus) {
          mutations.push(
            tx.insert(vehicleStatusEvents).values({
              vehicleId: trip.vehicleId,
              previousStatus: trip.vehicleStatus,
              newStatus: restrictedVehicleStatus,
              reason: `${input.severity === 'critical' ? 'Critical' : 'Vehicle safety'} incident ${officialNumber} — vehicle restricted`,
              changedByUserId: input.reportedByUserId,
              referenceEntityType: 'trip_incident',
              referenceEntityId: incidentId,
            }),
          );
        }
      }
      return mutations;
    });
  } catch (error) {
    if (syncId && (error as { code?: string }).code === '23505') {
      const [existing] = await db
        .select()
        .from(tripIncidents)
        .where(and(
          eq(tripIncidents.tenantId, input.tenantId),
          eq(tripIncidents.tripId, input.tripId),
          eq(tripIncidents.clientSyncId, syncId),
          eq(tripIncidents.reportedByUserId, input.reportedByUserId),
        ))
        .limit(1);
      if (existing) {
        return { incident: existing, officialNumber: existing.officialNumber || existing.id, idempotent: true };
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
  await deliverIncidentSideEffects(
    input,
    incident,
    officialNumber,
    maintenanceAssigneeUserId,
    trip.status,
    requiresVehicleRestriction,
  );
  return { incident, officialNumber };
}
