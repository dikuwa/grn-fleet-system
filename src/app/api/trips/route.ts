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
import { transportRequests } from '@/db/schema/requests';
import { employees, driverProfiles } from '@/db/schema/people';
import { eq, and, desc, asc, like, or, sql, type SQL } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * GET /api/trips
 * List trips with optional filters.
 * Supports: status, driver_assigned (resolves session user → employee → driver → allocations), search, page, limit
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status')?.trim();
    const driverAssigned = searchParams.get('driver_assigned') === 'true';
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const db = getDb();
    const tenantId = session.tenantId;
    const conditions: SQL[] = [eq(trips.tenantId, tenantId)];

    // Resolve driver_assigned: find the employee → driver profile for the current user
    let driverEmployeeId: string | null = null;
    if (driverAssigned) {
      const [emp] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (emp) {
        const [profile] = await db
          .select({ id: driverProfiles.id })
          .from(driverProfiles)
          .where(eq(driverProfiles.employeeId, emp.id))
          .limit(1);
        if (profile) {
          driverEmployeeId = emp.id;
        }
      }
      // If no driver profile found, return empty (the user isn't a driver)
      if (!driverEmployeeId) {
        return NextResponse.json({ success: true, data: [], totalCount: 0, page, totalPages: 0 });
      }
    }

    if (driverEmployeeId) {
      conditions.push(eq(vehicleAllocations.driverEmployeeId, driverEmployeeId));
    }
    if (status) {
      conditions.push(eq(trips.status, status));
    }
    if (search) {
      conditions.push(
        or(
          like(vehicles.licenceNumber, `%${search}%`),
          like(vehicles.make, `%${search}%`),
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [dbRows, totalResult] = await Promise.all([
      db
        .select({
          id: trips.id,
          status: trips.status,
          issuedAt: trips.issuedAt,
          startedAt: trips.startedAt,
          returnedAt: trips.returnedAt,
          closedAt: trips.closedAt,
          createdAt: trips.createdAt,
          vehicleId: trips.vehicleId,
          make: vehicles.make,
          model: vehicles.model,
          licenceNumber: vehicles.licenceNumber,
          vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
          requestReference: transportRequests.reference,
          hasDepartureInspection: sql<boolean>`EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.trip_id = ${trips.id} AND vi.type = 'departure')`,
          hasReturnInspection: sql<boolean>`EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.trip_id = ${trips.id} AND vi.type = 'return')`,
          purpose: transportRequests.purpose,
        })
        .from(trips)
        .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
        .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
        .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(where)
        .orderBy(desc(trips.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(trips)
        .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(where),
    ]);

    const totalCount = Number(totalResult[0]?.count ?? 0);
    const totalPages = Math.ceil(totalCount / limit);

    // Map rows to include backward-compatible field names for driver pages
    const data = dbRows.map((row) => ({
      ...row,
      reference: row.requestReference,
      vehicleLicence: row.licenceNumber,
      startAt: row.startedAt || row.issuedAt,
      endAt: row.returnedAt || row.closedAt,
    }));

    return NextResponse.json({
      success: true,
      data,
      rows: data,
      totalCount,
      page,
      totalPages,
      driverAssigned,
    });
  } catch (error) {
    console.error('[Trips API] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trips: ' + String(error) },
      { status: 500 },
    );
  }
}

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
