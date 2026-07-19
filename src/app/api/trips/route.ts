/**
 * Trips API
 *
 * GET  /api/trips   — List trips
 * POST /api/trips   — Create a trip from an allocation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { allocationId, requestId, vehicleId } = body;

    if (!allocationId || !requestId || !vehicleId) {
      return NextResponse.json({ error: 'allocationId, requestId, and vehicleId are required' }, { status: 400 });
    }

    const db = getDb();

    // Verify allocation exists and belongs to this tenant (via vehicle join)
    const [allocation] = await db
      .select({ id: vehicleAllocations.id, state: vehicleAllocations.state })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, allocationId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    // Check if a trip already exists for this allocation
    const [existingTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.allocationId, allocationId), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (existingTrip) {
      return NextResponse.json({ error: 'A trip already exists for this allocation' }, { status: 409 });
    }

    // Create the trip
    const [trip] = await db
      .insert(trips)
      .values({
        tenantId: session.tenantId,
        requestId,
        allocationId,
        vehicleId,
        status: 'pending',
        issuedAt: new Date(),
      })
      .returning();

    // Auto-confirm the allocation if it was provisional
    if (allocation.state === 'provisional') {
      await db
        .update(vehicleAllocations)
        .set({ state: 'confirmed', updatedAt: new Date() })
        .where(eq(vehicleAllocations.id, allocationId));
    }

    return NextResponse.json({ success: true, trip }, { status: 201 });
  } catch (error) {
    console.error('[Trips] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create trip' }, { status: 500 });
  }
}
