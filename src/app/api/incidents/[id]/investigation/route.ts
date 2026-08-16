/**
 * Investigation API
 *
 * PATCH /api/incidents/[id]/investigation — Update investigation status/notes
 * GET /api/incidents/[id]/investigation — Fetch investigation state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
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

    const permCheck = await requirePermission(
      session,
      Permissions.INCIDENT_INVESTIGATE,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await req.json();

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
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error('[incidents/investigation] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update investigation' }, { status: 500 });
  }
}
