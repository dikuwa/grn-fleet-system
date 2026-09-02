/**
 * Technical Clearance API
 *
 * PATCH /api/incidents/[id]/technical-clearance — Record technical clearance
 * GET /api/incidents/[id]/technical-clearance — Fetch technical clearance state
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleDefects } from '@/db/schema/fleet';
import { trips } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
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

    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    // Granted technical clearance is terminal. A repeat grant is an idempotent
    // read of the original decision so retries cannot rewrite the original
    // clearance actor or timestamp.
    if (incident.technicalClearanceStatus === 'cleared') {
      if (body.status === 'cleared') {
        return NextResponse.json({ data: incident, alreadyCleared: true });
      }
      return NextResponse.json(
        {
          error:
            'Technical clearance has already been granted. Record a new safety defect or incident if the vehicle requires renewed restriction.',
        },
        { status: 409 },
      );
    }

    // Keep the dedicated endpoint aligned with the unified safety predicate.
    // A damaged vehicle, an explicitly unsafe vehicle, or any critical incident
    // requires blocking-defect resolution before technical clearance.
    const requiresTechnicalClearance =
      incident.vehicleDamage ||
      incident.vehicleSafe === false ||
      incident.severity === 'critical';
    if (body.status === 'cleared' && requiresTechnicalClearance) {
      const db = getDb();
      const [trip] = await db
        .select({ vehicleId: trips.vehicleId })
        .from(trips)
        .where(and(eq(trips.id, incident.tripId), eq(trips.tenantId, session.tenantId)))
        .limit(1);

      if (!trip) {
        return NextResponse.json({ error: 'Incident trip not found' }, { status: 404 });
      }

      const [unresolvedBlockingDefect] = await db
        .select({ id: vehicleDefects.id })
        .from(vehicleDefects)
        .where(
          and(
            eq(vehicleDefects.vehicleId, trip.vehicleId),
            eq(vehicleDefects.isBlocking, true),
            isNull(vehicleDefects.resolvedAt),
          ),
        )
        .limit(1);

      if (unresolvedBlockingDefect) {
        return NextResponse.json(
          { error: 'Resolve all blocking vehicle defects before technical clearance.' },
          { status: 409 },
        );
      }
    }

    const result = await recordTechnicalClearance(
      session.tenantId,
      id,
      session.user.id,
      { status: body.status },
    );

    if (!result.ok) {
      if (result.error === 'not_found') {
        return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
      }
      if (result.error === 'clearance_already_granted') {
        return NextResponse.json(
          {
            error:
              'Technical clearance has already been granted and cannot be reverted by this workflow.',
          },
          { status: 409 },
        );
      }
      if (result.error === 'technical_clearance_conflict') {
        return NextResponse.json(
          {
            error:
              'The technical-clearance state changed while this decision was being saved. Refresh the incident before trying again.',
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      data: result.data,
      alreadyCleared: result.idempotent === true,
    });
  } catch (error) {
    console.error('[incidents/technical-clearance] PATCH failed:', error);
    const { message } = getDatabaseErrorDetails(error);
    if (message.includes('incident_technical_clearance_revocation_blocked')) {
      return NextResponse.json(
        {
          error:
            'Technical clearance has already been granted and cannot be reverted by this workflow.',
        },
        { status: 409 },
      );
    }
    if (message.includes('incident_technical_clearance_blocked')) {
      return NextResponse.json(
        {
          error:
            'A blocking vehicle defect was recorded while technical clearance was being granted. Refresh the incident and resolve all blocking defects before clearing the vehicle.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to record technical clearance' }, { status: 500 });
  }
}
