import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripExpenses,
  tripIncidentSequences,
  tripIncidents,
  tripProgressEntries,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import {
  maintenanceEvents,
  vehicleDefects,
  vehicleStatusEvents,
  vehicles,
} from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema';
import { hasPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { setAuthorityStatus } from '@/lib/trip-authority';
import { generateDocument } from '@/lib/document-generator';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

const progressTypes = [
  'official_stop',
  'passenger_pickup',
  'passenger_drop_off',
  'fuel_stop',
  'overnight_stop',
  'breakdown',
  'border_point',
  'destination_reached',
  'return_departure',
  'arrival',
  'route_deviation',
] as const;
const expenseCategories = [
  'petrol',
  'diesel',
  'oil',
  'toll',
  'parking',
  'accommodation',
  'repairs',
  'emergency_parts',
  'other',
];
const severities = ['minor', 'moderate', 'serious', 'critical'] as const;
const continuationStates = [
  'safe_to_continue',
  'continue_with_caution',
  'temporary_repair_completed',
  'waiting_for_assistance',
  'recovery_required',
  'replacement_vehicle_required',
  'trip_suspended',
  'trip_terminated',
] as const;
const defectTypes = new Set([
  'mechanical_defect',
  'electrical_defect',
  'tyre_failure',
  'breakdown',
  'warning_light',
  'fuel_leak_issue',
  'fire_smoke',
  'vehicle_defect',
  'tyre_damage',
  'physical_vehicle_damage',
  'accident_collision',
  'third_party_vehicle_damage',
  'property_damage',
]);
const forcedCriticalTypes = new Set(['fuel_leak_issue', 'fire_smoke']);

async function notifyTransportAdministrators(
  tenantId: string,
  values: {
    type: string;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    actionUrl?: string | null;
    priority?: string;
  },
) {
  const recipients = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TRANSPORT_ADMIN]);
  await createScopedNotifications({
    tenantId,
    recipientUserIds: recipients,
    category: 'action_required',
    eventType: values.type,
    title: values.title,
    body: values.body,
    entityType: values.entityType,
    entityId: values.entityId,
    actionUrl: values.actionUrl,
    workspace: WorkspaceIds.TRANSPORT_ADMIN,
    priority: values.priority,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || '');
    const db = getDb();

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    const [context] = await db
      .select({
        tripStatus: trips.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        vehicleId: trips.vehicleId,
        beginningOdometer: tripAuthorities.beginningOdometer,
        endingOdometer: tripAuthorities.endingOdometer,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (!context) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const canManage = await hasPermission(session, Permissions.TRIP_MANAGE);
    if (!canManage && (!employee || employee.id !== context.driverEmployeeId)) {
      return NextResponse.json(
        { error: 'Only the assigned driver or Transport Administrator may update this trip' },
        { status: 403 },
      );
    }
    if (!['in_progress', 'return_due', 'closure_review'].includes(context.tripStatus)) {
      return NextResponse.json(
        { error: `Trip updates are unavailable while status is "${context.tripStatus}"` },
        { status: 409 },
      );
    }

    const clientSyncId = typeof body.clientSyncId === 'string' ? body.clientSyncId : null;
    const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json(
        { error: 'A valid occurrence date and time is required' },
        { status: 422 },
      );
    }

    if (action === 'progress') {
      const entryType = String(body.entryType || '');
      if (!progressTypes.includes(entryType as (typeof progressTypes)[number])) {
        return NextResponse.json(
          { error: 'Select a valid progress or stop type' },
          { status: 422 },
        );
      }
      const odometer =
        body.odometerReading === null || body.odometerReading === undefined
          ? null
          : Number(body.odometerReading);
      const [previous] = await db
        .select({ value: tripProgressEntries.odometerReading })
        .from(tripProgressEntries)
        .where(
          and(eq(tripProgressEntries.tripId, id), isNotNull(tripProgressEntries.odometerReading)),
        )
        .orderBy(desc(tripProgressEntries.occurredAt))
        .limit(1);
      const floor = previous?.value ?? context.beginningOdometer ?? 0;
      if (odometer !== null && (!Number.isInteger(odometer) || odometer < floor)) {
        return NextResponse.json(
          { error: `Odometer must be a whole number at or above ${floor}` },
          { status: 422 },
        );
      }
      if (entryType === 'route_deviation' && !String(body.routeDeviationReason || '').trim()) {
        return NextResponse.json(
          { error: 'A route deviation reason is required' },
          { status: 422 },
        );
      }
      const [entry] = await db
        .insert(tripProgressEntries)
        .values({
          tenantId: session.tenantId,
          tripId: id,
          clientSyncId,
          entryType,
          occurredAt,
          location: body.location ? String(body.location) : null,
          latitude: body.latitude !== undefined ? String(body.latitude) : null,
          longitude: body.longitude !== undefined ? String(body.longitude) : null,
          odometerReading: odometer,
          note: body.note ? String(body.note) : null,
          routeDeviationReason: body.routeDeviationReason
            ? String(body.routeDeviationReason)
            : null,
          priorApprovalObtained:
            typeof body.priorApprovalObtained === 'boolean' ? body.priorApprovalObtained : null,
          attachmentKey: body.attachmentKey ? String(body.attachmentKey) : null,
          createdByUserId: session.user.id,
          offlineCreatedAt: body.offlineCreatedAt ? new Date(String(body.offlineCreatedAt)) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!entry && clientSyncId) {
        const [existing] = await db
          .select()
          .from(tripProgressEntries)
          .where(
            and(
              eq(tripProgressEntries.tenantId, session.tenantId),
              eq(tripProgressEntries.clientSyncId, clientSyncId),
            ),
          )
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      if (entryType === 'route_deviation' && context.authorityStatus === 'in_progress') {
        await setAuthorityStatus({
          authorityId: context.authorityId,
          tenantId: session.tenantId,
          next: 'route_deviation_pending_review',
        });
        await notifyTransportAdministrators(session.tenantId, {
          type: 'route_deviation',
          title: 'Route deviation requires review',
          body: String(body.routeDeviationReason),
          entityType: 'trip',
          entityId: id,
          actionUrl: `/dashboard/trips/${id}`,
          priority: body.priorApprovalObtained ? 'high' : 'emergency',
        });
      }
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType:
          entryType === 'route_deviation' ? 'route_deviation_recorded' : 'trip_progress_recorded',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'create',
        entityType: 'trip_progress',
        entityId: entry.id,
        summary: `${entryType.replaceAll('_', ' ')} recorded`,
        after: { tripId: id, odometer, location: body.location },
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      return NextResponse.json({ success: true, data: entry }, { status: 201 });
    }

    if (action === 'expense') {
      const category = String(body.category || '');
      const amount = Number(body.amount);
      if (!expenseCategories.includes(category) || !Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { error: 'A valid category and positive amount are required' },
          { status: 422 },
        );
      }
      const [expense] = await db
        .insert(tripExpenses)
        .values({
          tenantId: session.tenantId,
          tripId: id,
          clientSyncId,
          category,
          supplier: body.supplier ? String(body.supplier) : null,
          transactionAt: occurredAt,
          referenceNumber: body.referenceNumber ? String(body.referenceNumber) : null,
          amount: amount.toFixed(2),
          currency: body.currency ? String(body.currency).toUpperCase() : 'NAD',
          odometerReading: body.odometerReading ? Number(body.odometerReading) : null,
          receiptKey: body.receiptKey ? String(body.receiptKey) : null,
          notes: body.note ? String(body.note) : null,
          enteredByUserId: session.user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!expense && clientSyncId) {
        const [existing] = await db
          .select()
          .from(tripExpenses)
          .where(
            and(
              eq(tripExpenses.tenantId, session.tenantId),
              eq(tripExpenses.clientSyncId, clientSyncId),
            ),
          )
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_expense_created',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'create',
        entityType: 'trip_expense',
        entityId: expense.id,
        summary: `${category.replaceAll('_', ' ')} expense recorded — ${expense.currency} ${expense.amount}`,
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      return NextResponse.json({ success: true, data: expense }, { status: 201 });
    }

    if (action === 'incident') {
      const incidentType = String(body.incidentType || '');
      const description = String(body.description || '').trim();
      // Accept any non-empty incident type (supports tenant-configurable categories)
      if (incidentType.length < 3 || incidentType.length > 100 || description.length < 10) {
        return NextResponse.json(
          { error: 'Select an incident type and provide a useful description' },
          { status: 422 },
        );
      }
      let severity = severities.includes(String(body.severity) as (typeof severities)[number])
        ? String(body.severity)
        : 'minor';
      if (
        forcedCriticalTypes.has(incidentType) ||
        /\b(brake|brakes|steering|fuel leak|fire|structural damage)\b/i.test(description)
      )
        severity = 'critical';
      if (body.injuries === true && severity === 'minor') severity = 'moderate';
      const continuationState = continuationStates.includes(
        String(body.continuationState) as (typeof continuationStates)[number],
      )
        ? String(body.continuationState)
        : body.safeToContinue === true
          ? 'safe_to_continue'
          : 'waiting_for_assistance';
      const requestedContinuation = [
        'safe_to_continue',
        'continue_with_caution',
        'temporary_repair_completed',
      ].includes(continuationState);
      if (severity === 'critical' && requestedContinuation) {
        return NextResponse.json(
          {
            error:
              'Critical safety events require Transport Office or technical clearance before the journey can continue',
          },
          { status: 422 },
        );
      }
      if (body.vehicleSafe === false && requestedContinuation) {
        return NextResponse.json(
          { error: 'A vehicle declared unsafe cannot be marked as continuing the journey' },
          { status: 422 },
        );
      }
      const safeToContinue = requestedContinuation;
      const numberInjured =
        body.injuries === true ? Math.max(1, Number(body.numberInjured) || 1) : 0;
      const rapidReport = body.rapidReport === true;
      const year = occurredAt.getUTCFullYear();
      const [sequence] = await db
        .insert(tripIncidentSequences)
        .values({
          tenantId: session.tenantId,
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
      const numberPrefix =
        ['accident', 'accident_collision'].includes(incidentType) &&
        ['serious', 'critical'].includes(severity)
          ? 'ACC'
          : 'TID';
      const officialNumber = `${numberPrefix}-${year}-${String(sequence.currentValue).padStart(5, '0')}`;
      const [incident] = await db
        .insert(tripIncidents)
        .values({
          tenantId: session.tenantId,
          tripId: id,
          clientSyncId,
          officialNumber,
          incidentType,
          incidentCategoryCode: incidentType,
          severity,
          occurredAt,
          location: body.location ? String(body.location) : null,
          odometerReading: body.odometerReading ? Number(body.odometerReading) : null,
          description,
          injuries: body.injuries === true,
          numberInjured,
          vehicleDamage: body.vehicleDamage === true,
          thirdPartyInvolvement: body.thirdPartyInvolvement === true,
          policeReference: body.policeReference ? String(body.policeReference) : null,
          emergencyServicesContacted: body.emergencyServicesContacted === true,
          safeToContinue,
          continuationState,
          vehicleSafe: body.vehicleSafe === true,
          passengerSafe: body.passengerSafe !== false,
          detailsRequired: rapidReport,
          dailyLogEntryId: body.dailyLogEntryId ? String(body.dailyLogEntryId) : null,
          journeyLegReference: body.journeyLegReference ? String(body.journeyLegReference) : null,
          origin: body.origin ? String(body.origin) : null,
          destination: body.destination ? String(body.destination) : null,
          weather: body.weather ? String(body.weather) : null,
          roadCondition: body.roadCondition ? String(body.roadCondition) : null,
          thirdPartyDetails:
            body.thirdPartyInvolvement === true && typeof body.thirdPartyDetails === 'object'
              ? (body.thirdPartyDetails as Record<string, unknown>)
              : null,
          notificationState: {
            transportOffice: true,
            supervisor: severity !== 'minor',
            maintenance: defectTypes.has(incidentType),
          },
          actionTaken: body.actionTaken ? String(body.actionTaken) : null,
          attachmentKeys: Array.isArray(body.attachmentKeys) ? body.attachmentKeys.map(String) : [],
          attachmentHashes:
            body.attachmentHashes && typeof body.attachmentHashes === 'object'
              ? (body.attachmentHashes as Record<string, string>)
              : {},
          reportedByUserId: session.user.id,
          offlineCreatedAt: body.offlineCreatedAt ? new Date(String(body.offlineCreatedAt)) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!incident && clientSyncId) {
        const [existing] = await db
          .select()
          .from(tripIncidents)
          .where(
            and(
              eq(tripIncidents.tenantId, session.tenantId),
              eq(tripIncidents.clientSyncId, clientSyncId),
            ),
          )
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      if (defectTypes.has(incidentType)) {
        const isBlocking = severity === 'critical';
        const [defect] = await db
          .insert(vehicleDefects)
          .values({
            vehicleId: context.vehicleId,
            tripId: id,
            severity: severity === 'moderate' ? 'major' : severity,
            description: `${officialNumber}: ${description}`,
            isBlocking,
            reportedByUserId: session.user.id,
          })
          .returning({ id: vehicleDefects.id });
        if (isBlocking) {
          const [vehicle] = await db
            .select({ status: vehicles.status })
            .from(vehicles)
            .where(and(eq(vehicles.id, context.vehicleId), eq(vehicles.tenantId, session.tenantId)))
            .limit(1);
          await db
            .update(vehicles)
            .set({ status: 'maintenance', updatedAt: new Date(), updatedBy: session.user.id })
            .where(
              and(eq(vehicles.id, context.vehicleId), eq(vehicles.tenantId, session.tenantId)),
            );
          await db.insert(vehicleStatusEvents).values({
            vehicleId: context.vehicleId,
            previousStatus: vehicle?.status,
            newStatus: 'maintenance',
            reason: `Critical trip event ${officialNumber}`,
            changedByUserId: session.user.id,
            referenceEntityType: 'trip_incident',
            referenceEntityId: incident.id,
          });
          await db.insert(maintenanceEvents).values({
            vehicleId: context.vehicleId,
            serviceDate: occurredAt.toISOString().slice(0, 10),
            serviceOdometer: body.odometerReading ? Number(body.odometerReading) : null,
            serviceType: 'repair',
            description: `Safety-critical follow-up for ${officialNumber}`,
            notes: `Created automatically from defect ${defect.id}. Vehicle requires authorised technical clearance.`,
            createdByUserId: session.user.id,
          });
        }
      }
      if (
        ['in_progress', 'delayed', 'route_deviation_pending_review'].includes(
          context.authorityStatus,
        )
      ) {
        await setAuthorityStatus({
          authorityId: context.authorityId,
          tenantId: session.tenantId,
          next: 'incident_reported',
        });
      }
      await notifyTransportAdministrators(session.tenantId, {
        type: 'trip_incident',
        title: `${severity === 'critical' ? 'Critical' : severity} event ${officialNumber}`,
        body: `${description}${rapidReport ? ' — additional details required' : ''}`,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/trips/${id}`,
        priority:
          severity === 'critical' ? 'emergency' : severity === 'serious' ? 'urgent' : 'high',
      });
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_incident_reported',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'report',
        entityType: 'trip_incident',
        entityId: incident.id,
        summary: `${officialNumber}: ${incidentType.replaceAll('_', ' ')} (${severity}) reported`,
        after: {
          tripId: id,
          officialNumber,
          severity,
          continuationState,
          safeToContinue,
          injuries: body.injuries,
          vehicleDamage: body.vehicleDamage,
          detailsRequired: rapidReport,
        },
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      await generateDocument({
        documentType:
          ['accident', 'accident_collision'].includes(incidentType) &&
          ['serious', 'critical'].includes(severity)
            ? 'accident_report'
            : 'trip_incident_report',
        entityType: 'trip_incident',
        entityId: incident.id,
        tenantId: session.tenantId,
        generatedByUserId: session.user.id,
      }).catch((documentError) =>
        console.error('[trips/operations] Incident document generation failed:', documentError),
      );
      return NextResponse.json({ success: true, data: incident }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unsupported operation' }, { status: 400 });
  } catch (error) {
    console.error('[trips/operations] POST failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save trip operation',
      },
      { status: 500 },
    );
  }
}
