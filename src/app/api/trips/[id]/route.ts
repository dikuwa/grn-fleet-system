/**
 * Trip Detail API
 *
 * GET /api/trips/[id] — Fetch a single trip with vehicle info
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(_req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        tenantId: trips.tenantId,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        vehicleId: trips.vehicleId,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
        closedAt: trips.closedAt,
        createdAt: trips.createdAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(trips)
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, trip });
  } catch (error) {
    console.error('[Trip Detail] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch trip' }, { status: 500 });
  }
}
