import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripClosures, fuelTransactions } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripClosed } from '@/lib/document-generator';
import { eq } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const { decision, reviewNotes } = body;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require trip close permission
    const permCheck = await requirePermission(session, Permissions.TRIP_CLOSE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Find the trip
    const [trip] = await db
      .select()
      .from(trips)
      .where(eq(trips.id, id))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status === 'closed') {
      return NextResponse.json({ error: 'Trip is already closed' }, { status: 409 });
    }

    // Calculate totals from fuel transactions
    const fuel = await db
      .select()
      .from(fuelTransactions)
      .where(eq(fuelTransactions.tripId, id));

    const totalFuelLitres = fuel.reduce((sum, f) => sum + Number(f.litres), 0);
    const totalFuelCost = fuel.reduce((sum, f) => sum + Number(f.amount), 0);

    // Create or update the trip closure record
    const [closure] = await db
      .insert(tripClosures)
      .values({
        tripId: id,
        authorisedKilometres: body.authorisedKm || null,
        actualKilometres: body.actualKm || null,
        kilometreVariance: null,
        totalFuelLitres: totalFuelLitres ? String(totalFuelLitres) : null,
        totalFuelCost: totalFuelCost ? String(totalFuelCost) : null,
        reviewNotes: reviewNotes || null,
        closedByUserId: userId,
        decision: decision || 'closed',
      })
      .returning();

    // Update trip status
    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();

    // Trigger document generation (trip completion + fuel summary)
    const docs = await onTripClosed(id, tenantId, userId);

    return NextResponse.json({ trip: updatedTrip, closure, documents: docs?.filter(Boolean) || [] });
  } catch (error) {
    console.error('[trips/close] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to close trip' },
      { status: 500 },
    );
  }
}
