/**
 * Incidents API
 *
 * POST /api/incidents — Driver/operations incident reporting
 * GET  /api/incidents?tripId=xxx — Scoped incident list
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripIncidents, trips } from '@/db/schema/trips';
import {
  getSessionRoleNames,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { createIncident } from '@/lib/incidents/create-incident';
import { getIncidentCategory } from '@/lib/incidents/categories';
import { canAcceptLateOfflineIncident } from '@/lib/incidents/offline-incident-window';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { tripScopeCondition } from '@/lib/record-scope';

const POSTGRES_INT_MAX = 2_147_483_647;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const continuationStates = new Set([
  'safe_to_continue',
  'continue_with_caution',
  'temporary_repair_completed',
  'waiting_for_assistance',
  'recovery_required',
  'replacement_vehicle_required',
  'trip_suspended',
  'trip_terminated',
]);

const journeyContinuationStates = new Set([
  'safe_to_continue',
  'continue_with_caution',
  'temporary_repair_completed',
]);

async function resolveIncidentAccess(session: Parameters<typeof requirePermission>[0]) {
  const [reportCheck, manageCheck, viewCheck] = await Promise.all([
    requirePermission(session, Permissions.TRIP_INCIDENT_REPORT),
    requirePermission(session, Permissions.TRIP_INCIDENT_MANAGE),
    requirePermission(session, Permissions.TRIP_VIEW),
  ]);

  const canReport = !(reportCheck instanceof NextResponse);
  const canManage = !(manageCheck instanceof NextResponse);
  const canView = !(viewCheck instanceof NextResponse);
  return {
    canReport,
    canManage,
    canView,
    readDenied: !canReport && !canManage && !canView ? viewCheck : null,
    writeDenied: !canReport && !canManage ? reportCheck : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const access = await resolveIncidentAccess(session);
    if (access.readDenied) return access.readDenied;

    const roleNames = await getSessionRoleNames(session);
    const tripAccess = resolveDashboardAccess('/dashboard/trips', roleNames);
    if (!tripAccess.allowed || !tripAccess.actions.includes('view')) {
      return NextResponse.json({ error: 'Incident access is not available in this workspace' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get('tripId');
    if (tripId && !UUID_PATTERN.test(tripId)) {
      return NextResponse.json({ error: 'tripId must be a valid UUID' }, { status: 400 });
    }
    const db = getDb();

    const conditions: SQL[] = [
      eq(tripIncidents.tenantId, session.tenantId),
      eq(trips.tenantId, session.tenantId),
      tripScopeCondition({
        tenantId: session.tenantId,
        userId: session.user.id,
        recordScope: tripAccess.recordScope ?? 'assigned',
      }),
    ];
    if (tripId) conditions.push(eq(tripIncidents.tripId, tripId));

    const rows = await db
      .select({ incident: tripIncidents })
      .from(tripIncidents)
      .innerJoin(trips, eq(trips.id, tripIncidents.tripId))
      .where(and(...conditions))
      .orderBy(desc(tripIncidents.occurredAt));

    const data = rows.map((row) => row.incident);
    return NextResponse.json({
      data,
      total: data.length,
      capabilities: {
        canView: true,
        canReport: access.canReport,
        canManage: access.canManage,
      },
    });
  } catch (error) {
    console.error('[incidents] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const access = await resolveIncidentAccess(session);
    if (access.writeDenied) return access.writeDenied;

    const body = await req.json();
    const {
      tripId,
      clientSyncId,
      offlineCreatedAt,
      incidentType = 'damage',
      incidentCategoryCode,
      occurredAt,
      location,
      odometerReading,
      description,
      injuries = false,
      numberInjured,
      vehicleDamage = false,
      vehicleSafe = null,
      passengerSafe,
      thirdPartyInvolvement = false,
      policeReference,
      emergencyServicesContacted = false,
      safeToContinue = true,
      actionTaken,
      attachmentKeys,
      severity = 'minor',
      continuationState = safeToContinue ? 'safe_to_continue' : 'waiting_for_assistance',
    } = body;

    if (!tripId) return NextResponse.json({ error: 'Trip ID is required' }, { status: 400 });
    if (typeof tripId !== 'string' || !UUID_PATTERN.test(tripId)) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const syncId = typeof clientSyncId === 'string' && clientSyncId.trim() ? clientSyncId.trim() : null;
    if (syncId && syncId.length > 128) {
      return NextResponse.json({ error: 'Client sync ID is too long' }, { status: 422 });
    }

    const db = getDb();
    const tripConditions: SQL[] = [eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)];
    if (!access.canManage) {
      tripConditions.push(
        tripScopeCondition({ tenantId: session.tenantId, userId: session.user.id, recordScope: 'assigned' }),
      );
    }

    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
        closedAt: trips.closedAt,
      })
      .from(trips)
      .where(and(...tripConditions))
      .limit(1);
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    if (syncId) {
      const [existing] = await db
        .select()
        .from(tripIncidents)
        .where(
          and(
            eq(tripIncidents.tenantId, session.tenantId),
            eq(tripIncidents.tripId, tripId),
            eq(tripIncidents.reportedByUserId, session.user.id),
            eq(tripIncidents.clientSyncId, syncId),
          ),
        )
        .limit(1);
      if (existing) {
        return NextResponse.json(
          { data: existing, idempotent: true, acceptedLateOfflineIncident: false },
          { status: 200 },
        );
      }
    }

    if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    if (!incidentType) return NextResponse.json({ error: 'Incident type is required' }, { status: 400 });
    if (!['minor', 'moderate', 'serious', 'critical'].includes(severity)) {
      return NextResponse.json({ error: 'Severity must be minor, moderate, serious or critical' }, { status: 422 });
    }
    if (typeof injuries !== 'boolean') {
      return NextResponse.json({ error: 'Injuries must be true or false' }, { status: 422 });
    }
    const hasSuppliedInjuryCount =
      numberInjured !== null && numberInjured !== undefined && numberInjured !== '';
    const injuryCountHasValidRawType =
      typeof numberInjured === 'number' ||
      (typeof numberInjured === 'string' &&
        numberInjured.trim() !== '' &&
        Number.isFinite(Number(numberInjured)));
    if (hasSuppliedInjuryCount && !injuryCountHasValidRawType) {
      return NextResponse.json({ error: 'Number injured must be a numeric whole number' }, { status: 422 });
    }
    const suppliedInjuryCount = hasSuppliedInjuryCount ? Number(numberInjured) : null;
    if (
      suppliedInjuryCount !== null &&
      (!Number.isInteger(suppliedInjuryCount) || suppliedInjuryCount < 0)
    ) {
      return NextResponse.json({ error: 'Number injured must be a non-negative whole number' }, { status: 422 });
    }
    if (suppliedInjuryCount !== null && suppliedInjuryCount > POSTGRES_INT_MAX) {
      return NextResponse.json({ error: 'Number injured exceeds the supported integer range' }, { status: 422 });
    }
    if (injuries && suppliedInjuryCount === 0) {
      return NextResponse.json({ error: 'Number injured must be at least 1 when injuries are reported' }, { status: 422 });
    }
    if (!injuries && suppliedInjuryCount !== null && suppliedInjuryCount > 0) {
      return NextResponse.json({ error: 'Number injured must be 0 when no injuries are reported' }, { status: 422 });
    }
    const normalizedInjuryCount = injuries ? suppliedInjuryCount ?? 1 : 0;
    if (typeof vehicleDamage !== 'boolean') {
      return NextResponse.json({ error: 'Vehicle damage must be true or false' }, { status: 422 });
    }
    if (vehicleSafe !== null && vehicleSafe !== undefined && typeof vehicleSafe !== 'boolean') {
      return NextResponse.json({ error: 'Vehicle safety must be true, false, or omitted when unknown' }, { status: 422 });
    }
    if (passengerSafe !== null && passengerSafe !== undefined && typeof passengerSafe !== 'boolean') {
      return NextResponse.json({ error: 'Passenger safety must be true, false, or omitted when unknown' }, { status: 422 });
    }
    if (typeof safeToContinue !== 'boolean') {
      return NextResponse.json({ error: 'Journey continuation safety must be true or false' }, { status: 422 });
    }
    if (!continuationStates.has(String(continuationState))) {
      return NextResponse.json({ error: 'Select a valid journey continuation state' }, { status: 422 });
    }

    const requestedContinuation = journeyContinuationStates.has(String(continuationState));
    if (safeToContinue !== requestedContinuation) {
      return NextResponse.json({ error: 'Journey continuation safety does not match the selected continuation state' }, { status: 422 });
    }
    if (severity === 'critical' && requestedContinuation) {
      return NextResponse.json(
        { error: 'Critical safety events require Transport Office or technical clearance before the journey can continue' },
        { status: 422 },
      );
    }
    if (vehicleSafe === false && requestedContinuation) {
      return NextResponse.json({ error: 'A vehicle declared unsafe cannot be marked as continuing the journey' }, { status: 422 });
    }

    const eventDate = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(eventDate.getTime())) {
      return NextResponse.json({ error: 'A valid event date is required' }, { status: 422 });
    }
    if (eventDate.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Incident time cannot be in the future' }, { status: 422 });
    }

    const offlineDate = offlineCreatedAt ? new Date(offlineCreatedAt) : null;
    if (offlineCreatedAt && (!offlineDate || Number.isNaN(offlineDate.getTime()))) {
      return NextResponse.json({ error: 'Offline creation time is invalid' }, { status: 422 });
    }
    if (offlineDate && offlineDate.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Offline creation time cannot be in the future' }, { status: 422 });
    }

    const odometer =
      odometerReading === null || odometerReading === undefined || odometerReading === ''
        ? null
        : Number(odometerReading);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) {
      return NextResponse.json({ error: 'Odometer reading must be a non-negative whole number' }, { status: 422 });
    }
    if (attachmentKeys !== undefined && !Array.isArray(attachmentKeys)) {
      return NextResponse.json({ error: 'Attachments must be a list' }, { status: 422 });
    }

    const activeForJourney = ['in_progress', 'return_due'].includes(trip.status);
    const acceptedLateOfflineIncident =
      !activeForJourney &&
      canAcceptLateOfflineIncident({
        tripStatus: trip.status,
        startedAt: trip.startedAt,
        returnedAt: trip.returnedAt,
        closedAt: trip.closedAt,
        occurredAt: eventDate,
        offlineCreatedAt: offlineDate,
        clientSyncId: syncId,
      });
    if (!activeForJourney && !acceptedLateOfflineIncident) {
      return NextResponse.json(
        {
          error:
            'This trip is no longer active for new incident reports. A saved offline incident is accepted only when its occurrence and local draft timestamps both fall within the recorded journey window.',
        },
        { status: 409 },
      );
    }

    const categoryCode = incidentCategoryCode || incidentType;
    let categoryRequiresMva = false;
    if (categoryCode) {
      const category = await getIncidentCategory(session.tenantId, categoryCode);
      if (category) categoryRequiresMva = category.requiresMvaForm;
    }

    const result = await createIncident({
      tenantId: session.tenantId,
      tripId,
      clientSyncId: syncId,
      incidentType,
      incidentCategoryCode: categoryCode,
      requiresMvaForm: categoryRequiresMva,
      severity,
      occurredAt: eventDate,
      location: location || null,
      odometerReading: odometer,
      description: description.trim(),
      injuries,
      numberInjured: normalizedInjuryCount,
      vehicleDamage,
      vehicleSafe,
      passengerSafe: typeof passengerSafe === 'boolean' ? passengerSafe : undefined,
      thirdPartyInvolvement: Boolean(thirdPartyInvolvement),
      policeReference: policeReference || null,
      emergencyServicesContacted: Boolean(emergencyServicesContacted),
      safeToContinue: requestedContinuation,
      continuationState: String(continuationState),
      actionTaken: actionTaken || null,
      attachmentKeys: attachmentKeys || [],
      attachmentHashes: body.attachmentHashes || {},
      offlineCreatedAt: offlineDate,
      reportedByUserId: session.user.id,
    });

    return NextResponse.json(
      { data: result.incident, idempotent: result.idempotent === true, acceptedLateOfflineIncident },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (error) {
    const { code, message } = getDatabaseErrorDetails(error);
    if (code === '23514' && message.includes('trip_progress_lifecycle_conflict')) {
      return NextResponse.json(
        {
          error:
            'The incident could not be recorded because the trip or its uploaded evidence changed. Refresh the trip and retry with newly uploaded evidence.',
        },
        { status: 409 },
      );
    }
    if (code === '23505') {
      return NextResponse.json(
        {
          error:
            'This offline incident sync ID is already used by another incident. Refresh or generate a new local sync ID before retrying.',
        },
        { status: 409 },
      );
    }
    console.error('[incidents] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}
