/**
 * Incidents API
 *
 * POST /api/incidents — Create a trip incident (damage, accident, etc.)
 * GET /api/incidents?tripId=xxx — List incidents for a trip
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripIncidentSequences, tripIncidents, trips } from '@/db/schema/trips';

import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { requirePermission } from '@/lib/auth-helpers';
import { generateDocument } from '@/lib/document-generator';
import { eq, and, desc, sql } from 'drizzle-orm';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

/**
 * GET /api/incidents?tripId=xxx
 * List incidents for a trip (or all if admin)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get('tripId');
    const db = getDb();

    const conditions = [eq(tripIncidents.tenantId, session.tenantId)];
    if (tripId) conditions.push(eq(tripIncidents.tripId, tripId));

    const rows = await db
      .select()
      .from(tripIncidents)
      .where(and(...conditions))
      .orderBy(desc(tripIncidents.occurredAt));

    return NextResponse.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[incidents] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 });
  }
}

/**
 * POST /api/incidents
 * Create a new trip incident triggered from the damage action buttons
 * on the return inspection page or elsewhere.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();

    const {
      tripId,
      incidentType = 'damage',
      occurredAt,
      location,
      odometerReading,
      description,
      injuries = false,
      vehicleDamage = true,
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
    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }
    if (!incidentType) {
      return NextResponse.json({ error: 'Incident type is required' }, { status: 400 });
    }
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (!trip)
      return NextResponse.json({ error: 'Trip not found in your organisation' }, { status: 404 });
    if (!['minor', 'moderate', 'serious', 'critical'].includes(severity)) {
      return NextResponse.json(
        { error: 'Severity must be minor, moderate, serious or critical' },
        { status: 422 },
      );
    }
    const eventDate = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(eventDate.getTime()))
      return NextResponse.json({ error: 'A valid event date is required' }, { status: 422 });
    const year = eventDate.getUTCFullYear();
    const [sequence] = await db
      .insert(tripIncidentSequences)
      .values({ tenantId: session.tenantId, sequenceYear: year, currentValue: 1 })
      .onConflictDoUpdate({
        target: [tripIncidentSequences.tenantId, tripIncidentSequences.sequenceYear],
        set: {
          currentValue: sql`${tripIncidentSequences.currentValue} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ currentValue: tripIncidentSequences.currentValue });
    const officialNumber = `${['accident', 'accident_collision'].includes(incidentType) && ['serious', 'critical'].includes(severity) ? 'ACC' : 'TID'}-${year}-${String(sequence.currentValue).padStart(5, '0')}`;

    const [incident] = await db
      .insert(tripIncidents)
      .values({
        tenantId: session.tenantId,
        tripId,
        officialNumber,
        incidentType,
        severity,
        occurredAt: eventDate,
        location: location || null,
        odometerReading: odometerReading ? Number(odometerReading) : null,
        description,
        injuries,
        vehicleDamage,
        thirdPartyInvolvement,
        policeReference: policeReference || null,
        emergencyServicesContacted,
        safeToContinue,
        continuationState,
        vehicleSafe: safeToContinue,
        passengerSafe: !injuries,
        numberInjured: injuries ? 1 : 0,
        actionTaken: actionTaken || null,
        attachmentKeys: attachmentKeys || [],
        status: 'reported',
        reportedByUserId: session.user.id,
      })
      .returning();

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'incident_created',
      actorUserId: session.user.id,
      action: 'create',
      entityType: 'trip_incident',
      entityId: incident.id,
      summary: `${officialNumber}: ${incidentType} (${severity}) — ${description.slice(0, 120)}${description.length > 120 ? '...' : ''}`,
      sourceChannel: 'web',
    });

    // Notify relevant parties
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: [session.user.id],
      category: 'outcome',
      eventType: 'incident_reported',
      title: `${officialNumber} — ${incidentType.replace(/_/g, ' ')}`,
      body: `${description.slice(0, 200)}. Trip: ${tripId.slice(0, 8)}.`,
      entityType: 'trip_incident',
      entityId: incident.id,
      actionUrl: `/dashboard/trips/${tripId}`,
      workspace: WorkspaceIds.DRIVER,
      priority: 'high',
    });
    const transportAdministrators = await resolveActiveRoleRecipients(session.tenantId, [
      SystemRoles.TRANSPORT_ADMIN,
    ]);
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: transportAdministrators,
      category: 'action_required',
      eventType: 'trip_incident_review',
      title: `${officialNumber} requires operational review`,
      body: description.slice(0, 200),
      entityType: 'trip_incident',
      entityId: incident.id,
      actionUrl: `/dashboard/trips/${tripId}`,
      workspace: WorkspaceIds.TRANSPORT_ADMIN,
      priority: severity === 'critical' ? 'emergency' : 'high',
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
      console.error('[incidents] Incident document generation failed:', documentError),
    );

    return NextResponse.json({ data: incident }, { status: 201 });
  } catch (error) {
    console.error('[incidents] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}
