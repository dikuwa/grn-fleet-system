/**
 * Technical Clearance API
 *
 * PATCH /api/incidents/[id]/technical-clearance — Record technical clearance
 * GET /api/incidents/[id]/technical-clearance — Fetch technical clearance state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  recordTechnicalClearance,
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

    const permCheck = await requirePermission(session, Permissions.INCIDENT_TECHNICAL_CLEARANCE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        technicalClearanceStatus: incident.technicalClearanceStatus,
        technicalClearanceAt: incident.technicalClearanceAt,
        technicalClearanceByUserId: incident.technicalClearanceByUserId,
      },
    });
  } catch (error) {
    console.error('[incidents/technical-clearance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch technical clearance' }, { status: 500 });
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
      Permissions.INCIDENT_TECHNICAL_CLEARANCE,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await req.json();

    if (!body.status || !['cleared', 'not_cleared'].includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be "cleared" or "not_cleared"' },
        { status: 400 },
      );
    }

    const result = await recordTechnicalClearance(
      session.tenantId,
      id,
      session.user.id,
      { status: body.status },
    );

    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error('[incidents/technical-clearance] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to record technical clearance' }, { status: 500 });
  }
}
