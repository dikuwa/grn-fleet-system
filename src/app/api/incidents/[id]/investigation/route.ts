/**
 * Investigation API
 *
 * PATCH /api/incidents/[id]/investigation — Update investigation status/notes
 * GET /api/incidents/[id]/investigation — Fetch investigation state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  INVESTIGATION_STATUSES,
  updateInvestigation,
  getTenantIncident,
} from '@/lib/incidents/mva';

const witnessTextFields = ['name', 'phone', 'statement'] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Investigation closers must be able to read the evidence they are
    // authorised to make a final decision on, even when their role does not
    // also grant ordinary investigation editing.
    const readPermission = await requireAnyPermission(session, [
      Permissions.INCIDENT_INVESTIGATE,
      Permissions.INCIDENT_CLOSE_INVESTIGATION,
    ]);
    if (readPermission instanceof NextResponse) return readPermission;

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

    if (
      body.status !== undefined &&
      (typeof body.status !== 'string' || !INVESTIGATION_STATUSES.includes(body.status))
    ) {
      return NextResponse.json({ error: 'Select a valid investigation status' }, { status: 422 });
    }
    if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Investigation notes must be text or null' }, { status: 422 });
    }
    if (
      body.accidentReportNumber !== undefined &&
      body.accidentReportNumber !== null &&
      typeof body.accidentReportNumber !== 'string'
    ) {
      return NextResponse.json({ error: 'Accident report number must be text or null' }, { status: 422 });
    }
    if (
      body.addedWitnesses !== undefined &&
      (!Array.isArray(body.addedWitnesses) ||
        body.addedWitnesses.some((witness: unknown) => {
          if (!witness || typeof witness !== 'object' || Array.isArray(witness)) return true;
          const witnessRecord = witness as Record<string, unknown>;
          return witnessTextFields.some(
            (field) =>
              witnessRecord[field] !== undefined &&
              witnessRecord[field] !== null &&
              typeof witnessRecord[field] !== 'string',
          );
        }))
    ) {
      return NextResponse.json(
        { error: 'Added witnesses and their name, phone and statement fields must contain text or null values' },
        { status: 422 },
      );
    }

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
        notes:
          typeof body.notes === 'string'
            ? body.notes.trim() || null
            : body.notes,
        addedWitnesses: body.addedWitnesses,
        accidentReportNumber:
          typeof body.accidentReportNumber === 'string'
            ? body.accidentReportNumber.trim() || undefined
            : undefined,
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

    return NextResponse.json({ data: result.data, alreadyClosed: false });
  } catch (error) {
    console.error('[incidents/investigation] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update investigation' }, { status: 500 });
  }
}
