import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { allocationId } = body;

    if (!allocationId) {
      return NextResponse.json({ error: 'Allocation ID is required' }, { status: 400 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    // Verify the allocation exists, belongs to this tenant, and is confirmed
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        requestId: vehicleAllocations.requestId,
        vehicleId: vehicleAllocations.vehicleId,
        state: vehicleAllocations.state,
        tenantId: vehicles.tenantId,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleAllocations.id, allocationId),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    if (allocation.state !== 'confirmed') {
      return NextResponse.json(
        { error: 'Only confirmed allocations can create trips. Current state: ' + allocation.state },
        { status: 409 },
      );
    }

    // Check if a trip already exists for this allocation
    const [existingTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.allocationId, allocationId))
      .limit(1);

    if (existingTrip) {
      return NextResponse.json({ error: 'A trip already exists for this allocation', tripId: existingTrip.id }, { status: 409 });
    }

    // Verify the transport request is approved
    const [request] = await db
      .select({ status: transportRequests.status })
      .from(transportRequests)
      .where(
        and(
          eq(transportRequests.id, allocation.requestId),
          eq(transportRequests.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!request) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }

    if (request.status !== 'approved' && request.status !== 'approved_emergency') {
      return NextResponse.json(
        { error: `Transport request must be approved (current: ${request.status})` },
        { status: 409 },
      );
    }

    // Create the trip
    const [trip] = await db
      .insert(trips)
      .values({
        tenantId: session.tenantId,
        requestId: allocation.requestId,
        allocationId: allocation.id,
        vehicleId: allocation.vehicleId,
        status: 'pending',
        issuedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ trip, message: 'Trip created successfully' });
  } catch (error) {
    console.error('[trips/create-from-allocation] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create trip from allocation' },
      { status: 500 },
    );
  }
}
