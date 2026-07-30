/**
 * Incidents API
 *
 * POST /api/incidents — Create a trip incident (damage, accident, etc.)
 * GET /api/incidents?tripId=xxx — List incidents for a trip
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripIncidents } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { notifications } from '@/db/schema/notifications';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { requirePermission } from '@/lib/auth-helpers';
import { eq, and, desc } from 'drizzle-orm';

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

    const [incident] = await db
      .insert(tripIncidents)
      .values({
        tenantId: session.tenantId,
        tripId,
        incidentType,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        location: location || null,
        odometerReading: odometerReading ? Number(odometerReading) : null,
        description,
        injuries,
        vehicleDamage,
        thirdPartyInvolvement,
        policeReference: policeReference || null,
        emergencyServicesContacted,
        safeToContinue,
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
      summary: `Incident: ${incidentType} — ${description.slice(0, 120)}${description.length > 120 ? '...' : ''}`,
      sourceChannel: 'web',
    });

    // Notify relevant parties
    await db.insert(notifications).values({
      tenantId: session.tenantId,
      recipientUserId: session.user.id,
      type: 'incident_created',
      title: `Incident Reported — ${incidentType.replace(/_/g, ' ')}`,
      body: `${description.slice(0, 200)}. Trip: ${tripId.slice(0, 8)}.`,
      entityType: 'trip_incident',
      entityId: incident.id,
      actionUrl: `/dashboard/trips/${tripId}`,
      priority: 'high',
    });

    return NextResponse.json({ data: incident }, { status: 201 });
  } catch (error) {
    console.error('[incidents] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}
