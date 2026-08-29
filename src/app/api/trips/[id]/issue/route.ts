import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { evaluateTripReleaseGate } from '@/lib/trip-release-gate';
import { POST as issueVehicleCore } from './core';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const actionCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
  if (actionCheck instanceof NextResponse) return actionCheck;
  const permissionCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
  if (permissionCheck instanceof NextResponse) return permissionCheck;

  const { id } = await context.params;
  const [trip] = await getDb()
    .select({ requestId: trips.requestId })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
    .limit(1);

  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const issueGate = await evaluateTripReleaseGate({
    tenantId: session.tenantId,
    requestId: trip.requestId,
    stage: 'issue',
  });
  const exactTripReady = issueGate.tripId === id;

  if (!issueGate.allowed || !exactTripReady) {
    return NextResponse.json(
      {
        error: exactTripReady
          ? issueGate.blockers[0]?.message ?? 'Trip is not ready for physical vehicle issue.'
          : 'The current trip allocation changed. Refresh and review the latest trip before physical vehicle issue.',
        blockers: issueGate.blockers,
        checks: issueGate.checks,
        driverKind: issueGate.driverKind,
        actionUrl: `/dashboard/trips/${id}`,
      },
      { status: 409 },
    );
  }

  return issueVehicleCore(request, { params: Promise.resolve({ id }) });
}
