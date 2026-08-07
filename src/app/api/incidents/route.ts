/**
 * Incidents API
 *
 * POST /api/incidents — Create a trip incident (atomic transaction)
 * GET /api/incidents?tripId=xxx — List incidents for a trip
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripIncidents } from '@/db/schema/trips';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { requirePermission } from '@/lib/auth-helpers';
import { createIncident } from '@/lib/incidents/create-incident';
import { getIncidentCategory } from '@/lib/incidents/categories';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List incidents for a trip
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST — Create a new incident
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();

    const {
      tripId,
      incidentType = 'damage',
      incidentCategoryCode,
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
    if (!['minor', 'moderate', 'serious', 'critical'].includes(severity)) {
      return NextResponse.json(
        { error: 'Severity must be minor, moderate, serious or critical' },
        { status: 422 },
      );
    }

    const eventDate = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(eventDate.getTime())) {
      return NextResponse.json({ error: 'A valid event date is required' }, { status: 422 });
    }

    // If no explicit category code was sent, treat the incident type as the
    // category code (the driver workspace submits the category code as the type).
    const categoryCode = incidentCategoryCode || incidentType;

    // Look up category to determine MVA form requirement
    let requiresMvaForm = false;
    if (categoryCode) {
      const category = await getIncidentCategory(session.tenantId, categoryCode);
      if (category) requiresMvaForm = category.requiresMvaForm;
    }

    const { incident } = await createIncident({
      tenantId: session.tenantId,
      tripId,
      incidentType,
      incidentCategoryCode: categoryCode,
      requiresMvaForm,
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
      actionTaken: actionTaken || null,
      attachmentKeys: attachmentKeys || [],
      attachmentHashes: body.attachmentHashes || {},
      reportedByUserId: session.user.id,
    });

    return NextResponse.json({ data: incident }, { status: 201 });
  } catch (error) {
    console.error('[incidents] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}
