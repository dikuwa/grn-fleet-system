/**
 * Trip Log Entries API
 *
 * GET  /api/trip-logs   — List log entries for a trip (requires auth)
 * POST /api/trip-logs   — Create a log entry (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripLogEntries, trips, vehicleAllocations } from '@/db/schema/trips';
import { requestDrivers } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';

/**
 * GET /api/trip-logs
 * List log entries for a specific trip, or all recent entries.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/logs', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.TRIP_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const tripId = searchParams.get('tripId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = getDb();
    const roles = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/logs', roles);

    const conditions = [];

    if (tripId) {
      conditions.push(eq(tripLogEntries.tripId, tripId));
    }

    // Tenant isolation via trips join
    conditions.push(eq(trips.tenantId, session.tenantId));
    conditions.push(
      tripScopeCondition({
        tenantId: session.tenantId,
        userId: session.user.id,
        recordScope: access.recordScope ?? 'assigned',
      }),
    );

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: tripLogEntries.id,
        tripId: tripLogEntries.tripId,
        logDate: tripLogEntries.logDate,
        odometerOut: tripLogEntries.odometerOut,
        odometerIn: tripLogEntries.odometerIn,
        departureTime: tripLogEntries.departureTime,
        arrivalTime: tripLogEntries.arrivalTime,
        origin: tripLogEntries.origin,
        destination: tripLogEntries.destination,
        distanceKm: tripLogEntries.distanceKm,
        remarks: tripLogEntries.remarks,
        isSynced: tripLogEntries.isSynced,
        syncState: tripLogEntries.syncState,
        createdAt: tripLogEntries.createdAt,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(tripLogEntries)
      .leftJoin(trips, eq(tripLogEntries.tripId, trips.id))
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .where(whereClause)
      .orderBy(desc(tripLogEntries.logDate))
      .limit(limit);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[TripLogs] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch log entries: ' + String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/trip-logs
 * Create a new daily log entry.
 * Requires DRIVER_LOG_CREATE or TRIP_MANAGE permission.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/logs', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;

    // Check permission — driver log or trip manager
    const permCheck = await requirePermission(session, Permissions.DRIVER_LOG_CREATE);
    if (permCheck instanceof NextResponse) {
      const managerPerm = await requirePermission(session, Permissions.TRIP_MANAGE);
      if (managerPerm instanceof NextResponse) return managerPerm;
    }

    const body = await request.json();
    const {
      tripId,
      logDate,
      odometerOut,
      odometerIn,
      departureTime,
      arrivalTime,
      origin,
      destination,
      distanceKm,
      remarks,
      clientSyncId,
    } = body;

    if (!tripId) {
      return NextResponse.json({ error: 'Trip ID is required' }, { status: 400 });
    }
    if (!logDate) {
      return NextResponse.json({ error: 'Log date is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the trip exists and belongs to the tenant
    const [trip] = await db
      .select({
        id: trips.id,
        tenantId: trips.tenantId,
        status: trips.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(eq(trips.id, tripId))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.tenantId !== session.tenantId) {
      return NextResponse.json(
        { error: 'Trip does not belong to your organisation' },
        { status: 403 },
      );
    }

    if (!['in_progress', 'return_due'].includes(trip.status)) {
      return NextResponse.json(
        { error: 'Trip logs may only be added while a trip is in progress' },
        { status: 409 },
      );
    }

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, session.tenantId),
          eq(employees.userId, session.user.id),
          eq(employees.employmentStatus, 'active'),
        ),
      )
      .limit(1);
    if (!employee)
      return NextResponse.json(
        { error: 'Your login is not linked to an active employee record' },
        { status: 403 },
      );
    if (employee.id !== trip.driverEmployeeId) {
      const [additionalAssignment] = await db
        .select({ id: requestDrivers.id })
        .from(requestDrivers)
        .innerJoin(trips, eq(trips.requestId, requestDrivers.requestId))
        .where(
          and(
            eq(trips.id, tripId),
            eq(requestDrivers.employeeId, employee.id),
            inArray(requestDrivers.driverType, ['assigned', 'additional']),
          ),
        )
        .limit(1);
      if (!additionalAssignment)
        return NextResponse.json(
          { error: 'Only an assigned driver may add trip logs' },
          { status: 403 },
        );
    }

    const out =
      odometerOut === null || odometerOut === undefined || odometerOut === ''
        ? null
        : Number(odometerOut);
    const incoming =
      odometerIn === null || odometerIn === undefined || odometerIn === ''
        ? null
        : Number(odometerIn);
    if (
      (out !== null && (!Number.isInteger(out) || out < 0)) ||
      (incoming !== null && (!Number.isInteger(incoming) || incoming < 0))
    ) {
      return NextResponse.json(
        { error: 'Odometer readings must be non-negative whole numbers' },
        { status: 422 },
      );
    }
    if (out !== null && incoming !== null && incoming < out)
      return NextResponse.json(
        { error: 'Odometer-in cannot be lower than odometer-out' },
        { status: 422 },
      );
    const calculatedDistance = out !== null && incoming !== null ? incoming - out : null;
    if (
      distanceKm !== null &&
      distanceKm !== undefined &&
      calculatedDistance !== null &&
      Number(distanceKm) !== calculatedDistance
    ) {
      return NextResponse.json(
        { error: 'Distance must match the submitted odometer readings' },
        { status: 422 },
      );
    }

    if (clientSyncId) {
      const [existing] = await db
        .select()
        .from(tripLogEntries)
        .where(
          and(eq(tripLogEntries.tripId, tripId), eq(tripLogEntries.clientSyncId, clientSyncId)),
        )
        .limit(1);
      if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true });
    }

    const [entry] = await db
      .insert(tripLogEntries)
      .values({
        tripId,
        clientSyncId: clientSyncId || null,
        driverEmployeeId: employee.id,
        logDate: new Date(logDate),
        odometerOut: out,
        odometerIn: incoming,
        departureTime: departureTime ? new Date(`${logDate}T${departureTime}`) : null,
        arrivalTime: arrivalTime ? new Date(`${logDate}T${arrivalTime}`) : null,
        origin: origin || null,
        destination: destination || null,
        distanceKm: calculatedDistance ?? (distanceKm ? Number(distanceKm) : null),
        remarks: remarks || null,
        isSynced: true,
        syncState: 'synced',
      })
      .returning();

    await db
      .insert(auditEvents)
      .values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_log_created',
        actorUserId: session.user.id,
        action: 'create',
        entityType: 'trip_log_entry',
        entityId: entry.id,
        summary: `Driver trip log recorded for ${logDate}`,
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    console.error('[TripLogs] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create log entry: ' + String(error) },
      { status: 500 },
    );
  }
}
