import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripExpenses,
  tripIncidents,
  tripProgressEntries,
  trips,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { hasPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tripScopeCondition } from '@/lib/record-scope';
import { runAtomicMutations } from '@/lib/db-atomic';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { createIncident } from '@/lib/incidents/create-incident';
import { getIncidentCategory } from '@/lib/incidents/categories';
import { canAcceptLateOfflineIncident } from '@/lib/incidents/offline-incident-window';

const progressTypes = [
  'official_stop',
  'passenger_pickup',
  'passenger_drop_off',
  'fuel_stop',
  'overnight_stop',
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
] as const;

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
const forcedCriticalTypes = new Set(['fuel_leak_issue', 'fire_smoke']);

async function notifyTransportAdministrators(
  tenantId: string,
  values: { type: string; title: string; body?: string | null; entityId: string; priority?: string },
) {
  const recipients = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TRANSPORT_ADMIN]);
  if (!recipients.length) return;
  await createScopedNotifications({
    tenantId,
    recipientUserIds: recipients,
    category: 'action_required',
    eventType: values.type,
    title: values.title,
    body: values.body,
    entityType: 'trip',
    entityId: values.entityId,
    actionUrl: `/dashboard/trips/${values.entityId}`,
    workspace: WorkspaceIds.TRANSPORT_ADMIN,
    priority: values.priority,
  });
}

function optionalDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    if (!['progress', 'expense', 'incident'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported operation' }, { status: 400 });
    }

    const clientSyncId =
      typeof body.clientSyncId === 'string' && body.clientSyncId.trim()
        ? body.clientSyncId.trim()
        : null;
    const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'A valid occurrence date and time is required' }, { status: 422 });
    }
    const offlineCreatedAt = optionalDate(body.offlineCreatedAt);
    if (body.offlineCreatedAt && !offlineCreatedAt) {
      return NextResponse.json({ error: 'Offline creation time is invalid' }, { status: 422 });
    }

    const db = getDb();
    const canManage = await hasPermission(session, Permissions.TRIP_MANAGE);
    const conditions = [eq(trips.id, id), eq(trips.tenantId, session.tenantId)];
    if (!canManage) {
      conditions.push(
        tripScopeCondition({
          tenantId: session.tenantId,
          userId: session.user.id,
          recordScope: 'assigned',
        }),
      );
    }

    const [[employee], [context]] = await Promise.all([
      db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
        .limit(1),
      db
        .select({
          tripStatus: trips.status,
          startedAt: trips.startedAt,
          returnedAt: trips.returnedAt,
          closedAt: trips.closedAt,
          authorityId: tripAuthorities.id,
          authorityStatus: tripAuthorities.status,
          vehicleId: trips.vehicleId,
          beginningOdometer: tripAuthorities.beginningOdometer,
          endingOdometer: tripAuthorities.endingOdometer,
        })
        .from(trips)
        .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
        .where(and(...conditions))
        .limit(1),
    ]);
    if (!context) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    // A committed offline mutation must remain recoverable after the trip or
    // authority advances. Scope recovery to the already-authorised trip and to
    // the same recorder so a sync token cannot be used to browse another user's
    // operation. New writes continue through the live lifecycle checks below.
    if (clientSyncId) {
      if (action === 'progress') {
        const [existing] = await db
          .select()
          .from(tripProgressEntries)
          .where(and(
            eq(tripProgressEntries.tenantId, session.tenantId),
            eq(tripProgressEntries.tripId, id),
            eq(tripProgressEntries.clientSyncId, clientSyncId),
            eq(tripProgressEntries.createdByUserId, session.user.id),
          ))
          .limit(1);
        if (existing) {
          return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
        }
      } else if (action === 'expense') {
        const [existing] = await db
          .select()
          .from(tripExpenses)
          .where(and(
            eq(tripExpenses.tenantId, session.tenantId),
            eq(tripExpenses.tripId, id),
            eq(tripExpenses.clientSyncId, clientSyncId),
            eq(tripExpenses.enteredByUserId, session.user.id),
          ))
          .limit(1);
        if (existing) {
          return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
        }
      } else {
        const [existing] = await db
          .select()
          .from(tripIncidents)
          .where(and(
            eq(tripIncidents.tenantId, session.tenantId),
            eq(tripIncidents.tripId, id),
            eq(tripIncidents.clientSyncId, clientSyncId),
            eq(tripIncidents.reportedByUserId, session.user.id),
          ))
          .limit(1);
        if (existing) {
          return NextResponse.json({
            success: true,
            data: existing,
            idempotentReplay: true,
            acceptedLateOfflineIncident: false,
          });
        }
      }
    }

    const activeForJourney = ['in_progress', 'return_due'].includes(context.tripStatus);
    const acceptedLateOfflineIncident =
      action === 'incident' &&
      !activeForJourney &&
      canAcceptLateOfflineIncident({
        tripStatus: context.tripStatus,
        startedAt: context.startedAt,
        returnedAt: context.returnedAt,
        closedAt: context.closedAt,
        occurredAt,
        offlineCreatedAt,
        clientSyncId,
      });
    if (action === 'progress' && !activeForJourney) {
      return NextResponse.json({ error: 'This trip is no longer active for journey updates' }, { status: 409 });
    }
    if (action === 'incident' && !activeForJourney && !acceptedLateOfflineIncident) {
      return NextResponse.json(
        {
          error:
            'This trip is no longer active for new incident reports. A saved offline incident is accepted only when its occurrence and local draft timestamps both fall within the recorded journey window.',
        },
        { status: 409 },
      );
    }
    if (action === 'progress' && context.authorityStatus === 'incident_reported') {
      return NextResponse.json(
        {
          error:
            'Journey progress is on hold after a critical safety incident. Report further safety information if needed, record emergency expenses, or return/recover the vehicle for Transport and technical review.',
        },
        { status: 409 },
      );
    }
    if (action === 'expense' && !['in_progress', 'return_due', 'closure_review'].includes(context.tripStatus)) {
      return NextResponse.json({ error: 'Expenses are unavailable for this trip status' }, { status: 409 });
    }

    if (action === 'progress') {
      const entryType = String(body.entryType || '');
      if (entryType === 'breakdown') {
        return NextResponse.json(
          {
            error:
              'Breakdowns must be reported with “Report incident, damage or defect” so vehicle safety, Transport review and maintenance follow-up cannot be bypassed.',
          },
          { status: 422 },
        );
      }
      if (!progressTypes.includes(entryType as (typeof progressTypes)[number])) {
        return NextResponse.json({ error: 'Select a valid progress or stop type' }, { status: 422 });
      }
      const odometer =
        body.odometerReading === null || body.odometerReading === undefined || body.odometerReading === ''
          ? null
          : Number(body.odometerReading);
      const [previous] = await db
        .select({ value: tripProgressEntries.odometerReading })
        .from(tripProgressEntries)
        .where(and(eq(tripProgressEntries.tripId, id), isNotNull(tripProgressEntries.odometerReading)))
        .orderBy(desc(tripProgressEntries.occurredAt))
        .limit(1);
      const floor = previous?.value ?? context.beginningOdometer ?? 0;
      if (odometer !== null && (!Number.isInteger(odometer) || odometer < floor)) {
        return NextResponse.json({ error: `Odometer must be a whole number at or above ${floor}` }, { status: 422 });
      }
      if (entryType === 'route_deviation' && !String(body.routeDeviationReason || '').trim()) {
        return NextResponse.json({ error: 'A route deviation reason is required' }, { status: 422 });
      }
      const latitude = body.latitude === undefined || body.latitude === '' ? null : Number(body.latitude);
      const longitude = body.longitude === undefined || body.longitude === '' ? null : Number(body.longitude);
      if (
        (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      ) {
        return NextResponse.json({ error: 'Location coordinates are invalid' }, { status: 422 });
      }

      if (clientSyncId) {
        const [existing] = await db
          .select()
          .from(tripProgressEntries)
          .where(and(eq(tripProgressEntries.tenantId, session.tenantId), eq(tripProgressEntries.clientSyncId, clientSyncId)))
          .limit(1);
        if (existing) return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }

      const entryId = randomUUID();
      const deviation = entryType === 'route_deviation';
      await runAtomicMutations((executor) => {
        const mutations = [
          executor.insert(tripProgressEntries).values({
            id: entryId,
            tenantId: session.tenantId,
            tripId: id,
            clientSyncId,
            entryType,
            occurredAt,
            location: body.location ? String(body.location).trim() : null,
            latitude: latitude === null ? null : String(latitude),
            longitude: longitude === null ? null : String(longitude),
            odometerReading: odometer,
            note: body.note ? String(body.note).trim() : null,
            routeDeviationReason: deviation ? String(body.routeDeviationReason).trim() : null,
            priorApprovalObtained:
              typeof body.priorApprovalObtained === 'boolean' ? body.priorApprovalObtained : null,
            attachmentKey: body.attachmentKey ? String(body.attachmentKey) : null,
            createdByUserId: session.user.id,
            offlineCreatedAt,
          }),
          executor.insert(auditEvents).values({
            tenantId: session.tenantId,
            tenantSequence: Date.now(),
            eventType: deviation ? 'route_deviation_recorded' : 'trip_progress_recorded',
            actorUserId: session.user.id,
            actorEmployeeId: employee?.id,
            action: 'create',
            entityType: 'trip_progress',
            entityId: entryId,
            summary: `${entryType.replaceAll('_', ' ')} recorded`,
            after: { tripId: id, odometer, location: body.location },
            sourceChannel: clientSyncId ? 'offline_sync' : 'web',
          }),
        ];
        if (deviation && context.authorityStatus === 'in_progress') {
          mutations.push(
            executor
              .update(tripAuthorities)
              .set({ status: 'route_deviation_pending_review', updatedAt: new Date() })
              .where(and(eq(tripAuthorities.id, context.authorityId), eq(tripAuthorities.status, 'in_progress'))),
          );
        }
        return mutations;
      });

      const [entry] = await db.select().from(tripProgressEntries).where(eq(tripProgressEntries.id, entryId)).limit(1);
      if (!entry) throw new Error('Trip progress committed but could not be reloaded');
      if (deviation) {
        await notifyTransportAdministrators(session.tenantId, {
          type: 'route_deviation',
          title: 'Route deviation requires review',
          body: String(body.routeDeviationReason),
          entityId: id,
          priority: body.priorApprovalObtained ? 'high' : 'emergency',
        }).catch(() => {});
      }
      return NextResponse.json({ success: true, data: entry }, { status: 201 });
    }

    if (action === 'expense') {
      const category = String(body.category || '');
      const amount = Number(body.amount);
      if (!expenseCategories.includes(category as (typeof expenseCategories)[number]) || !Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'A valid category and positive amount are required' }, { status: 422 });
      }
      const odometer =
        body.odometerReading === null || body.odometerReading === undefined || body.odometerReading === ''
          ? null
          : Number(body.odometerReading);
      const floor = context.beginningOdometer ?? 0;
      const ceiling = context.endingOdometer;
      if (
        odometer !== null &&
        (!Number.isInteger(odometer) || odometer < floor || (ceiling !== null && odometer > ceiling))
      ) {
        return NextResponse.json({ error: 'Expense odometer is outside this trip’s recorded range' }, { status: 422 });
      }
      const currency = String(body.currency || 'NAD').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        return NextResponse.json({ error: 'Currency must use a three-letter code' }, { status: 422 });
      }
      if (clientSyncId) {
        const [existing] = await db
          .select()
          .from(tripExpenses)
          .where(and(eq(tripExpenses.tenantId, session.tenantId), eq(tripExpenses.clientSyncId, clientSyncId)))
          .limit(1);
        if (existing) return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }

      const expenseId = randomUUID();
      await runAtomicMutations((executor) => [
        executor.insert(tripExpenses).values({
          id: expenseId,
          tenantId: session.tenantId,
          tripId: id,
          clientSyncId,
          category,
          supplier: body.supplier ? String(body.supplier).trim() : null,
          transactionAt: occurredAt,
          referenceNumber: body.referenceNumber ? String(body.referenceNumber).trim() : null,
          amount: amount.toFixed(2),
          currency,
          odometerReading: odometer,
          receiptKey: body.receiptKey ? String(body.receiptKey) : null,
          notes: body.note ? String(body.note).trim() : null,
          enteredByUserId: session.user.id,
        }),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'trip_expense_created',
          actorUserId: session.user.id,
          actorEmployeeId: employee?.id,
          action: 'create',
          entityType: 'trip_expense',
          entityId: expenseId,
          summary: `${category.replaceAll('_', ' ')} expense recorded — ${currency} ${amount.toFixed(2)}`,
          sourceChannel: clientSyncId ? 'offline_sync' : 'web',
        }),
      ]);
      const [expense] = await db.select().from(tripExpenses).where(eq(tripExpenses.id, expenseId)).limit(1);
      if (!expense) throw new Error('Trip expense committed but could not be reloaded');
      return NextResponse.json({ success: true, data: expense }, { status: 201 });
    }

    const incidentType = String(body.incidentType || '').trim();
    const description = String(body.description || '').trim();
    if (incidentType.length < 3 || incidentType.length > 100 || description.length < 10) {
      return NextResponse.json({ error: 'Select an incident type and provide a useful description' }, { status: 422 });
    }
    let severity = severities.includes(String(body.severity) as (typeof severities)[number])
      ? (String(body.severity) as (typeof severities)[number])
      : 'minor';
    if (forcedCriticalTypes.has(incidentType) || /\b(brake|brakes|steering|fuel leak|fire|structural damage)\b/i.test(description)) {
      severity = 'critical';
    }
    if (body.injuries === true && severity === 'minor') severity = 'moderate';
    const continuationState = continuationStates.includes(
      String(body.continuationState) as (typeof continuationStates)[number],
    )
      ? String(body.continuationState)
      : body.safeToContinue === true
        ? 'safe_to_continue'
        : 'waiting_for_assistance';
    const requestedContinuation = ['safe_to_continue', 'continue_with_caution', 'temporary_repair_completed'].includes(continuationState);
    if (severity === 'critical' && requestedContinuation) {
      return NextResponse.json(
        { error: 'Critical safety events require Transport Office or technical clearance before the journey can continue' },
        { status: 422 },
      );
    }
    if (body.vehicleSafe === false && requestedContinuation) {
      return NextResponse.json({ error: 'A vehicle declared unsafe cannot be marked as continuing the journey' }, { status: 422 });
    }
    const odometer =
      body.odometerReading === null || body.odometerReading === undefined || body.odometerReading === ''
        ? null
        : Number(body.odometerReading);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < (context.beginningOdometer ?? 0))) {
      return NextResponse.json({ error: 'Incident odometer is invalid for this trip' }, { status: 422 });
    }
    const category = await getIncidentCategory(session.tenantId, incidentType);
    const result = await createIncident({
      tenantId: session.tenantId,
      tripId: id,
      clientSyncId,
      incidentType,
      incidentCategoryCode: incidentType,
      requiresMvaForm: category?.requiresMvaForm === true,
      severity,
      occurredAt,
      location: body.location ? String(body.location).trim() : null,
      odometerReading: odometer,
      description,
      injuries: body.injuries === true,
      vehicleDamage: body.vehicleDamage === true,
      thirdPartyInvolvement: body.thirdPartyInvolvement === true,
      policeReference: body.policeReference ? String(body.policeReference).trim() : null,
      emergencyServicesContacted: body.emergencyServicesContacted === true,
      safeToContinue: requestedContinuation,
      continuationState,
      vehicleSafe: typeof body.vehicleSafe === 'boolean' ? body.vehicleSafe : requestedContinuation,
      passengerSafe: body.passengerSafe !== false,
      numberInjured: body.injuries === true ? Math.max(1, Number(body.numberInjured) || 1) : 0,
      detailsRequired: body.rapidReport === true,
      dailyLogEntryId: body.dailyLogEntryId ? String(body.dailyLogEntryId) : null,
      journeyLegReference: body.journeyLegReference ? String(body.journeyLegReference) : null,
      origin: body.origin ? String(body.origin) : null,
      destination: body.destination ? String(body.destination) : null,
      weather: body.weather ? String(body.weather) : null,
      roadCondition: body.roadCondition ? String(body.roadCondition) : null,
      thirdPartyDetails:
        body.thirdPartyInvolvement === true && body.thirdPartyDetails && typeof body.thirdPartyDetails === 'object'
          ? (body.thirdPartyDetails as Record<string, unknown>)
          : null,
      notificationState: {
        transportOffice: true,
        supervisor: severity !== 'minor',
      },
      actionTaken: body.actionTaken ? String(body.actionTaken).trim() : null,
      attachmentKeys: Array.isArray(body.attachmentKeys) ? body.attachmentKeys.map(String) : [],
      attachmentHashes:
        body.attachmentHashes && typeof body.attachmentHashes === 'object'
          ? (body.attachmentHashes as Record<string, string>)
          : {},
      offlineCreatedAt,
      reportedByUserId: session.user.id,
    });
    return NextResponse.json(
      {
        success: true,
        data: result.incident,
        idempotentReplay: result.idempotent === true,
        acceptedLateOfflineIncident,
      },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'This offline update was already submitted' }, { status: 409 });
    }
    console.error('[trips/operations] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save trip operation' },
      { status: 500 },
    );
  }
}