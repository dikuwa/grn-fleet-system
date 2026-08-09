/**
 * Trips API
 *
 * GET  /api/trips   — List trips
 * POST /api/trips   — Legacy trip creation from a confirmed allocation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc, like, or, sql, type SQL } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { provisionTripAuthority } from '@/lib/trip-authority';
import { auditEvents } from '@/db/schema';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const viewCheck = await requireDashboardAction(session, '/dashboard/trips', 'view');
    if (viewCheck instanceof NextResponse) return viewCheck;
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/trips', roleNames);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status')?.trim();
    const driverAssigned =
      searchParams.get('driver_assigned') === 'true' || access.recordScope === 'assigned';
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const db = getDb();
    const tenantId = session.tenantId;
    const conditions: SQL[] = [
      tripScopeCondition({
        tenantId,
        userId: session.user.id,
        recordScope: access.recordScope ?? 'assigned',
      }),
    ];
    if (status) conditions.push(eq(trips.status, status));
    if (search) {
      conditions.push(
        or(like(vehicles.licenceNumber, `%${search}%`), like(vehicles.make, `%${search}%`))!,
      );
    }

    const where = and(...conditions);

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
          routeKm: sql<number>`COALESCE((
            SELECT SUM(COALESCE(rr.total_kilometres, rr.mapped_distance_km, 0))
            FROM request_routes rr
            WHERE rr.request_id = ${trips.requestId}
          ), 0)`.as('route_km'),
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
    return NextResponse.json({ error: 'Failed to fetch trips: ' + String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const allocationId = typeof body?.allocationId === 'string' ? body.allocationId.trim() : '';
    if (!allocationId) {
      return NextResponse.json({ error: 'allocationId is required' }, { status: 400 });
    }

    const db = getDb();
    const tenantId = session.tenantId;

    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        requestId: vehicleAllocations.requestId,
        vehicleId: vehicleAllocations.vehicleId,
        requestStatus: transportRequests.status,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(vehicleAllocations.id, allocationId),
        eq(vehicles.tenantId, tenantId),
        eq(transportRequests.tenantId, tenantId),
      ))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (allocation.state !== 'confirmed') {
      return NextResponse.json(
        { error: `Only confirmed allocations can create trips (current: ${allocation.state})` },
        { status: 409 },
      );
    }
    if (!['approved', 'approved_emergency', 'authorised', 'ready_for_issue', 'vehicle_allocated'].includes(allocation.requestStatus)) {
      return NextResponse.json(
        { error: `Transport request is not ready for trip creation (current: ${allocation.requestStatus})` },
        { status: 409 },
      );
    }

    const [existingTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.allocationId, allocationId), eq(trips.tenantId, tenantId)))
      .limit(1);
    if (existingTrip) {
      return NextResponse.json(
        { error: 'A trip already exists for this allocation', tripId: existingTrip.id },
        { status: 409 },
      );
    }

    const [trip] = await db
      .insert(trips)
      .values({
        tenantId,
        requestId: allocation.requestId,
        allocationId: allocation.id,
        vehicleId: allocation.vehicleId,
        status: 'pending',
      })
      .returning();

    try {
      const provisioned = await provisionTripAuthority({
        tripId: trip.id,
        tenantId,
        requestId: allocation.requestId,
        allocationId: allocation.id,
        actorUserId: session.user.id,
      });
      const [driver] = await db
        .select({ userId: employees.userId })
        .from(vehicleAllocations)
        .innerJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
        .where(and(eq(vehicleAllocations.id, allocation.id), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (driver?.userId) {
        await createScopedNotifications({
          tenantId,
          recipientUserIds: [driver.userId],
          category: 'action_required',
          eventType: 'driver_acceptance_required',
          title: `Trip Authority ${provisioned.authority.authorityNumber} requires acceptance`,
          body: 'Review and accept the official authority before completing the departure inspection.',
          entityType: 'trip',
          entityId: trip.id,
          actionUrl: `/dashboard/trips/${trip.id}`,
          workspace: WorkspaceIds.DRIVER,
          priority: 'high',
        });
      }
      await db.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_authority_issued',
        actorUserId: session.user.id,
        action: 'issue',
        entityType: 'trip_authority',
        entityId: provisioned.authority.id,
        summary: `Trip Authority ${provisioned.authority.authorityNumber} issued from approved request`,
        after: { tripId: trip.id, status: provisioned.authority.status },
        sourceChannel: 'web',
      });
      return NextResponse.json(
        { success: true, trip, authority: provisioned.authority },
        { status: 201 },
      );
    } catch (authorityError) {
      await db.delete(trips).where(and(eq(trips.id, trip.id), eq(trips.tenantId, tenantId)));
      throw authorityError;
    }
  } catch (error) {
    console.error('[Trips] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create trip' }, { status: 500 });
  }
}
