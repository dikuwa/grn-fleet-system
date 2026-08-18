import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { evaluateTripReleaseGate, type TripReleaseGateStage } from '@/lib/trip-release-gate';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;

    // Transport/authorisation users who may inspect release eligibility already
    // hold one of these operational permissions. Tenant management also gets
    // visibility through the dashboard action guard above.
    const permissionCandidates = [
      Permissions.TRIP_MANAGE,
      Permissions.REQUEST_REVIEW_TRANSPORT,
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_AUTHORIZE_NATIONAL,
      Permissions.VEHICLE_RELEASE_REGIONAL,
      Permissions.VEHICLE_RELEASE_NATIONAL,
    ];
    let permitted = false;
    for (const permission of permissionCandidates) {
      const check = await requirePermission(session, permission);
      if (!(check instanceof NextResponse)) {
        permitted = true;
        break;
      }
    }
    if (!permitted) {
      return NextResponse.json({ error: 'You do not have permission to inspect trip release eligibility.' }, { status: 403 });
    }

    const { id } = await params;
    const db = getDb();
    const [trip] = await db
      .select({ id: trips.id, requestId: trips.requestId })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const rawStage = req.nextUrl.searchParams.get('stage');
    const stage: TripReleaseGateStage = rawStage === 'authorisation' ? 'authorisation' : 'issue';
    const result = await evaluateTripReleaseGate({
      tenantId: session.tenantId,
      requestId: trip.requestId,
      stage,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Trip Release Gate] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to evaluate trip release eligibility.' },
      { status: 500 },
    );
  }
}
