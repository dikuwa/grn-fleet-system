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
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { tripScopeCondition } from '@/lib/record-scope';

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

// ---------------------------------------------------------------------------
// GET — List incidents within the active workspace's record scope
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST — Create a new incident
// ---------------------------------------------------------------------------

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
      incidentType = 'damage',
      incidentCategoryCode,
      occurredAt,
      location,
      odometerReading,
      description,
      injuries = false,
      vehicleDamage = false,
      vehicleSafe = null,
      thirdPartyInvolvement = false,
      policeReference,
      emergencyServicesContacted = false,
      safeToContinue = true,
      actionTaken,
      attachmentKeys,
      severity = 'minor',
      continuationState = safeToContinue ? 'safe_to_continue' : 'waiting_for_assistance',
    } = body;

    if (!tripId) {
      return NextResponse.json({ error: 'Trip ID is required' }, { status: 400 });
    }
    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }
    if (!incidentType) {
      return NextResponse.json({ error: 'Incident type is required' }, { status: 400 });
    }
    if (!['minor', 'moderate', 'serious', 'critical'].includes(severity)) {
      return NextResponse.json(
        { error: 'Severity must be minor, moderate, serious or critical' },
        { status: 422 },
      );
    }
    if (typeof vehicleDamage !== 'boolean') {
      return NextResponse.json({ error: 'Vehicle damage must be true or false' }, { status: 422 });
    }
    if (vehicleSafe !== null && vehicleSafe !== undefined && typeof vehicleSafe !== 'boolean') {
      return NextResponse.json(
        { error: 'Vehicle safety must be true, false, or omitted when unknown' },
        { status: 422 },
      );
    }
    if (typeof safeToContinue !== 'boolean') {
      return NextResponse.json(
        { error: 'Journey continuation safety must be true or false' },
        { status: 422 },
      );
    }

    const eventDate = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(eventDate.getTime())) {
      return NextResponse.json({ error: 'A valid event date is required' }, { status: 422 });
    }
    if (eventDate.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Incident time cannot be in the future' }, { status: 422 });
    }

    const odometer =
      odometerReading === null || odometerReading === undefined || odometerReading === ''
        ? null
        : Number(odometerReading);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) {
      return NextResponse.json(
        { error: 'Odometer reading must be a non-negative whole number' },
        { status: 422 },
      );
    }
    if (attachmentKeys !== undefined && !Array.isArray(attachmentKeys)) {
      return NextResponse.json({ error: 'Attachments must be a list' }, { status: 422 });
    }

    const db = getDb();

    // A report-only Driver must be assigned to the trip. Managers retain their
    // tenant-wide operational reporting capability. Return 404 to avoid leaking
    // whether an unassigned/other-tenant trip exists.
    if (!access.canManage) {
      const [assignedTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.id, tripId),
            tripScopeCondition({
              tenantId: session.tenantId,
              userId: session.user.id,
              recordScope: 'assigned',
            }),
          ),
        )
        .limit(1);
      if (!assignedTrip) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      }
    }

    // If no explicit category code was sent, treat the incident type as the
    // category code (the driver workspace submits the category code as the type).
    const categoryCode = incidentCategoryCode || incidentType;

    let categoryRequiresMva = false;
    if (categoryCode) {
      const category = await getIncidentCategory(session.tenantId, categoryCode);
      if (category) categoryRequiresMva = category.requiresMvaForm;
    }

    const result = await createIncident({
      tenantId: session.tenantId,
      tripId,
      clientSyncId: typeof clientSyncId === 'string' && clientSyncId.trim() ? clientSyncId.trim() : null,
      incidentType,
      incidentCategoryCode: categoryCode,
      requiresMvaForm: categoryRequiresMva,
      severity,
      occurredAt: eventDate,
      location: location || null,
      odometerReading: odometer,
      description: description.trim(),
      injuries: Boolean(injuries),
      vehicleDamage,
      vehicleSafe,
      thirdPartyInvolvement: Boolean(thirdPartyInvolvement),
      policeReference: policeReference || null,
      emergencyServicesContacted: Boolean(emergencyServicesContacted),
      safeToContinue,
      continuationState,
      actionTaken: actionTaken || null,
      attachmentKeys: attachmentKeys || [],
      attachmentHashes: body.attachmentHashes || {},
      reportedByUserId: session.user.id,
    });

    return NextResponse.json(
      { data: result.incident, idempotent: result.idempotent === true },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
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
