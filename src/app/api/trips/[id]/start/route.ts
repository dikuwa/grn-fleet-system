import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [trip] = await db
      .select()
      .from(trips)
      .where(eq(trips.id, id))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Trip not found in your tenant' }, { status: 404 });
    }

    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot start trip with status "${trip.status}". Only pending trips can be started.` },
        { status: 409 },
      );
    }

    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();

    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/start] POST failed:', error);
    return NextResponse.json({ error: 'Failed to start trip' }, { status: 500 });
  }
}
