/**
 * Atomic incident creation service.
 *
 * Wraps incident record, audit event, vehicle restriction (critical severity),
 * blocking defect, and maintenance follow-up in a single database transaction.
 * Notifications and document generation fire-and-forget after the transaction
 * commits so they cannot roll back the core record.
 */

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
import { eq, and, sql } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { generateDocument } from '@/lib/document-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateIncidentInput = {
  tripId: string;
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Create an incident atomically. The caller is responsible for sending
 * notifications and generating documents after this call returns.
 *
 * When severity is `critical`:
 *  - The allocated vehicle is moved to `maintenance` status
 *  - A blocking defect is recorded
 *  - A maintenance follow-up event is created
 */
export async function createIncident(
  input: CreateIncidentInput,
): Promise<CreateIncidentResult> {
  const db = getDb();
  const year = input.occurredAt.getUTCFullYear();

  const incident = await db.transaction(async (tx) => {
    // -----------------------------------------------------------------------
    // 1. Atomic authoritative event number
    // -----------------------------------------------------------------------
    const [sequence] = await tx
      .insert(tripIncidentSequences)
      .values({
        tenantId: input.tenantId,
        sequenceYear: year,
        currentValue: 1,
      })
      .onConflictDoUpdate({
        target: [
          tripIncidentSequences.tenantId,
          tripIncidentSequences.sequenceYear,
        ],
        set: {
          currentValue: sql`${tripIncidentSequences.currentValue} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ currentValue: tripIncidentSequences.currentValue });

    const officialNumber =
      `${isMvaType(input.incidentType) && isMvaSeverity(input.severity) ? 'ACC' : 'TID'}-${year}-${String(sequence.currentValue).padStart(5, '0')}`;

    // -----------------------------------------------------------------------
    // 2. Verify trip belongs to tenant
    // -----------------------------------------------------------------------
    const [trip] = await tx
      .select({ id: trips.id, vehicleId: trips.vehicleId })
      .from(trips)
      .where(
        and(
          eq(trips.id, input.tripId),
          eq(trips.tenantId, input.tenantId),
        ),
      )
      .limit(1);
    if (!trip) throw new Error('Trip not found in your organisation');

    // -----------------------------------------------------------------------
    // 3. Insert incident record
    // -----------------------------------------------------------------------
    const [created] = await tx
      .insert(tripIncidents)
      .values({
        tenantId: input.tenantId,
        tripId: input.tripId,
        officialNumber,
        incidentType: input.incidentType,
        incidentCategoryCode: input.incidentCategoryCode || null,
        severity: input.severity,
        occurredAt: input.occurredAt,
        location: input.location || null,
        odometerReading: input.odometerReading
          ? Number(input.odometerReading)
          : null,
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
        actionTaken: input.actionTaken || null,
        attachmentKeys: input.attachmentKeys || [],
        attachmentHashes: input.attachmentHashes || {},
        status: 'reported',
        reportedByUserId: input.reportedByUserId,
      })
      .returning();

    // -----------------------------------------------------------------------
    // 4. Audit event (inside transaction for consistency)
    // -----------------------------------------------------------------------
    await recordAuditEvent(
      {
        tenantId: input.tenantId,
        actorUserId: input.reportedByUserId,
        eventType: 'incident_created',
        action: 'create',
        entityType: 'trip_incident',
        entityId: created.id,
        summary:
          `${officialNumber}: ${input.incidentType} (${input.severity}) — ${input.description.slice(0, 120)}${input.description.length > 120 ? '...' : ''}`,
        sourceChannel: 'web',
      },
      tx,
    );

    // -----------------------------------------------------------------------
    // 5. Critical severity: restrict vehicle, record defect, create maintenance
    // -----------------------------------------------------------------------
    if (input.severity === 'critical' && trip.vehicleId) {
      const [vehicle] = await tx
        .select({ status: vehicles.status })
        .from(vehicles)
        .where(eq(vehicles.id, trip.vehicleId))
        .limit(1);

      if (vehicle) {
        // Move vehicle to maintenance
        await tx
          .update(vehicles)
          .set({ status: 'maintenance', updatedAt: new Date() })
          .where(eq(vehicles.id, trip.vehicleId));

        // Audit the status change
        await tx.insert(vehicleStatusEvents).values({
          vehicleId: trip.vehicleId,
          previousStatus: vehicle.status,
          newStatus: 'maintenance',
          reason: `Critical incident ${officialNumber} — vehicle restricted`,
          changedByUserId: input.reportedByUserId,
          referenceEntityType: 'trip_incident',
          referenceEntityId: created.id,
        });

        // Blocking defect
        await tx.insert(vehicleDefects).values({
          vehicleId: trip.vehicleId,
          tripId: input.tripId,
          severity: 'critical',
          description: `Critical incident ${officialNumber}: ${input.description.slice(0, 200)}`,
          isBlocking: true,
          reportedByUserId: input.reportedByUserId,
        });

        // Maintenance follow-up
        await tx.insert(maintenanceEvents).values({
          vehicleId: trip.vehicleId,
          serviceDate: new Date().toISOString().split('T')[0],
          serviceOdometer: input.odometerReading
            ? Number(input.odometerReading)
            : null,
          serviceType: 'repair',
          description: `Follow-up from critical incident ${officialNumber}. Vehicle must be inspected and cleared before returning to service.`,
          createdByUserId: input.reportedByUserId,
        });
      }
    }

    return { ...created, officialNumber } as typeof tripIncidents.$inferSelect & { officialNumber: string };
  });

  // -----------------------------------------------------------------------
  // 6. Fire-and-forget: notifications (post-transaction)
  // -----------------------------------------------------------------------
  const officialNumber = incident.officialNumber;

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
  }).catch(() => {});

  resolveActiveRoleRecipients(input.tenantId, [
    SystemRoles.TRANSPORT_ADMIN,
  ])
    .then((admins) =>
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
    )
    .catch(() => {});

  // -----------------------------------------------------------------------
  // 7. Fire-and-forget: document generation
  // -----------------------------------------------------------------------
  generateDocument({
    documentType: requiresMvaForm(input)
      ? 'accident_report'
      : 'trip_incident_report',
    entityType: 'trip_incident',
    entityId: incident.id,
    tenantId: input.tenantId,
    generatedByUserId: input.reportedByUserId,
  }).catch((err) =>
    console.error('[createIncident] Document generation failed:', err),
  );

  return { incident, officialNumber };
}
