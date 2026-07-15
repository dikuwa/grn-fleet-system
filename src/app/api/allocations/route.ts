import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations, trips } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { getServerSessionFromRequest } from '@/lib/session';
import { onTripIssued } from '@/lib/document-generator';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      requestId,
      requestReference,
      vehicleId,
      vehicleGrn,
      startDate,
      endDate,
    } = body;

    // Accept UUID or string reference for request
    let resolvedRequestId = requestId;
    let resolvedVehicleId = vehicleId;

    const db = getDb();
    const session = await getServerSessionFromRequest(req);
    const userId = session?.user.id || body.userId || 'system';
    const tenantId = session?.tenantId || body.tenantId || '00000000-0000-0000-0000-000000000001';

    // Look up request by reference if not a UUID
    if (!resolvedRequestId && requestReference) {
      const [found] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(eq(transportRequests.reference, requestReference))
        .limit(1);
      if (found) resolvedRequestId = found.id;
    }

    // Look up vehicle by GRN number if not a UUID
    if (!resolvedVehicleId && vehicleGrn) {
      const [found] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.grnNumber, vehicleGrn))
        .limit(1);
      if (found) resolvedVehicleId = found.id;
    }

    // Validate required fields
    if (!resolvedRequestId) {
      return NextResponse.json({ error: 'Request ID or reference is required' }, { status: 400 });
    }
    if (!resolvedVehicleId) {
      return NextResponse.json({ error: 'Vehicle ID or GRN is required' }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    // Verify the transport request exists
    const [foundReq] = await db
      .select({ id: transportRequests.id, status: transportRequests.status })
      .from(transportRequests)
      .where(eq(transportRequests.id, resolvedRequestId))
      .limit(1);

    if (!foundReq) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }

    // Verify the vehicle exists
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, resolvedVehicleId))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const startAt = new Date(startDate);
    const endAt = endDate ? new Date(endDate) : new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create the allocation
    const [allocation] = await db
      .insert(vehicleAllocations)
      .values({
        requestId: resolvedRequestId,
        vehicleId: resolvedVehicleId,
        startAt,
        endAt,
        state: 'confirmed',
        allocatedByUserId: userId,
      })
      .returning();

    // Create the trip record
    const [trip] = await db
      .insert(trips)
      .values({
        tenantId,
        requestId: resolvedRequestId,
        allocationId: allocation.id,
        vehicleId: resolvedVehicleId,
        status: 'pending',
      })
      .returning();

    // Trigger document generation (trip authority)
    const doc = await onTripIssued(allocation.id, tenantId, userId);

    return NextResponse.json({ allocation, trip, document: doc });
  } catch (error) {
    console.error('[allocations] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create allocation' },
      { status: 500 },
    );
  }
}
