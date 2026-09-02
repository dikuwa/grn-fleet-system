/**
 * Investigation API
 *
 * PATCH /api/incidents/[id]/investigation — Update investigation status/notes
 * GET /api/incidents/[id]/investigation — Fetch investigation state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { refreshIncidentTripCompletionIfClosed } from '@/lib/incidents/document-refresh';
import {
  updateInvestigation,
  getTenantIncident,
} from '@/lib/incidents/mva';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.INCIDENT_INVESTIGATE);
    if (permCheck instanceof NextResponse) return permCheck;
    const closePermission = await requirePermission(
      session,
      Permissions.INCIDENT_CLOSE_INVESTIGATION,
    );
    const canCloseInvestigation = !(closePermission instanceof NextResponse);

    const { id } = await params;
    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        investigationStatus: incident.investigationStatus,
        investigationNotes: incident.investigationNotes,
        investigationClosedAt: incident.investigationClosedAt,
        accidentReportNumber: incident.accidentReportNumber,
        witnessStatements: incident.witnessStatements,
      },
      capabilities: {
        canCloseInvestigation,
      },
    });
  } catch (error) {
    console.error('[incidents/investigation] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch investigation' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { id } = await params;
    const body = await req.json();
    const isClosing = body.status === 'closed';

    const permCheck = await requirePermission(
      session,
      isClosing ? Permissions.INCIDENT_CLOSE_INVESTIGATION : Permissions.INCIDENT_INVESTIGATE,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    // Closed investigation evidence is terminal. Keep repeat close requests
    // idempotent, but do not let this older dedicated endpoint reopen or edit a
    // closed/resolved incident after the incident-review workflow has finished.
    if (incident.investigationStatus === 'closed' || incident.status === 'resolved') {
      if (isClosing) {
        return NextResponse.json({ data: incident, alreadyClosed: true });
      }
      return NextResponse.json(
        {
          error:
            'This investigation is already closed. Closed incident evidence cannot be reopened through investigation editing.',
        },
        { status: 409 },
      );
    }

    // Keep this dedicated endpoint aligned with the unified incident safety
    // rule used by incident review, trip closure, and database clearance guards.
    // Damage, an explicitly unsafe vehicle, or a critical incident all require
    // technical clearance before the investigation can close.
    const requiresTechnicalClearance =
      incident.vehicleDamage ||
      incident.vehicleSafe === false ||
      incident.severity === 'critical';
    if (isClosing && requiresTechnicalClearance && incident.technicalClearanceStatus !== 'cleared') {
      return NextResponse.json(
        { error: 'Vehicle-safety investigations require technical clearance before closure.' },
        { status: 409 },
      );
    }

    const result = await updateInvestigation(
      session.tenantId,
      id,
      session.user.id,
      {
        status: body.status,
        notes: body.notes,
        addedWitnesses: body.addedWitnesses,
        accidentReportNumber: body.accidentReportNumber,
      },
    );

    if (!result.ok) {
      if (result.error === 'Incident not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      if (result.error === 'technical_clearance_required') {
        return NextResponse.json(
          { error: 'Vehicle-safety investigations require technical clearance before closure.' },
          { status: 409 },
        );
      }
      if (
        result.error === 'investigation_already_closed' ||
        result.error === 'investigation_update_conflict'
      ) {
        return NextResponse.json(
          {
            error:
              'The investigation changed while this update was being saved. Refresh before making another investigation decision.',
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (isClosing) {
      await refreshIncidentTripCompletionIfClosed({
        tenantId: session.tenantId,
        tripId: incident.tripId,
        actorUserId: session.user.id,
      });
    }

    return NextResponse.json({ data: result.data, alreadyClosed: false });
  } catch (error) {
    console.error('[incidents/investigation] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update investigation' }, { status: 500 });
  }
}
