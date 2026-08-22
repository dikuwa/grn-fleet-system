/**
 * Trip Log Entries API
 *
 * GET  /api/trip-logs   — List log entries for a trip (requires auth)
 * POST /api/trip-logs   — Create a log entry (requires auth)
 */

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripAuthorities, tripLogEntries, trips, vehicleAllocations } from '@/db/schema/trips';
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
import { runAtomicMutations } from '@/lib/db-atomic';

const LOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isValidLogDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOG_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidOptionalTime(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && TIME_PATTERN.test(value));
}

function windhoekDateTime(logDate: string, time: string): Date {
  return new Date(`${logDate}T${time}:00+02:00`);
}

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
    if (!isValidLogDate(logDate)) {
      return NextResponse.json(
        { error: 'Log date must be a valid date in YYYY-MM-DD format' },
        { status: 422 },
      );
    }
    if (!isValidOptionalTime(departureTime) || !isValidOptionalTime(arrivalTime)) {
      return NextResponse.json(
        { error: 'Departure and arrival times must use 24-hour HH:mm format' },
        { status: 422 },
      );
    }
    if (departureTime && arrivalTime && arrivalTime < departureTime) {
      return NextResponse.json(
        { error: 'Arrival time cannot be earlier than departure time' },
        { status: 422 },
      );
    }

    const syncId =
      typeof clientSyncId === 'string' && clientSyncId.trim() ? clientSyncId.trim() : null;
    if (syncId && syncId.length > 128) {
      return NextResponse.json({ error: 'Client sync ID is too long' }, { status: 422 });
    }

    const db = getDb();

    // Verify the trip exists inside this tenant. The current Trip Authority
    // supplies the immutable departure odometer floor used below; unlike a
    // "latest server reading" check, this remains safe when older offline daily
    // logs reconnect and sync after newer journey evidence.
    const [trip] = await db
      .select({
        id: trips.id,
        tenantId: trips.tenantId,
        status: trips.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        beginningOdometer: tripAuthorities.beginningOdometer,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(
        tripAuthorities,
        and(eq(tripAuthorities.tripId, trips.id), eq(tripAuthorities.tenantId, trips.tenantId)),
      )
      .where(and(eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    // Resolve the recorder before mutable lifecycle checks. Historical replay
    // remains available to the employee who originally wrote the record even
    // when the trip is now closed or the assignment has since changed.
    const [employee] = await db
      .select({ id: employees.id, employmentStatus: employees.employmentStatus })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, session.tenantId),
          eq(employees.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!employee) {
      return NextResponse.json(
        { error: 'Your login is not linked to an employee record' },
        { status: 403 },
      );
    }

    if (syncId) {
      const [existing] = await db
        .select()
        .from(tripLogEntries)
        .where(and(
          eq(tripLogEntries.tripId, tripId),
          eq(tripLogEntries.clientSyncId, syncId),
          eq(tripLogEntries.driverEmployeeId, employee.id),
        ))
        .limit(1);
      if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true });
    }

    if (employee.employmentStatus !== 'active') {
      return NextResponse.json(
        { error: 'Your employee record is not active' },
        { status: 403 },
      );
    }

    if (!['in_progress', 'return_due'].includes(trip.status)) {
      return NextResponse.json(
        { error: 'Trip logs may only be added while a trip is in progress' },
        { status: 409 },
      );
    }

    if (employee.id !== trip.driverEmployeeId) {
      const [additionalAssignment] = await db
        .select({ id: requestDrivers.id })
        .from(requestDrivers)
        .innerJoin(trips, eq(trips.requestId, requestDrivers.requestId))
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.tenantId, session.tenantId),
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
    const authorityFloor = trip.beginningOdometer ?? 0;
    if (
      (out !== null && out < authorityFloor) ||
      (incoming !== null && incoming < authorityFloor)
    ) {
      return NextResponse.json(
        {
          error: `Daily log odometer readings cannot be lower than the Trip Authority departure reading (${authorityFloor})`,
        },
        { status: 422 },
      );
    }
    if (out !== null && incoming !== null && incoming < out)
      return NextResponse.json(
        { error: 'Odometer-in cannot be lower than odometer-out' },
        { status: 422 },
      );
    const calculatedDistance = out !== null && incoming !== null ? incoming - out : null;
    const submittedDistance =
      distanceKm === null || distanceKm === undefined || distanceKm === ''
        ? null
        : Number(distanceKm);
    if (
      submittedDistance !== null &&
      (!Number.isInteger(submittedDistance) || submittedDistance < 0)
    ) {
      return NextResponse.json(
        { error: 'Distance must be a non-negative whole number' },
        { status: 422 },
      );
    }
    if (
      submittedDistance !== null &&
      calculatedDistance !== null &&
      submittedDistance !== calculatedDistance
    ) {
      return NextResponse.json(
        { error: 'Distance must match the submitted odometer readings' },
        { status: 422 },
      );
    }

    // Keep a second replay check immediately before the insert for concurrent
    // duplicate retries that both passed the earlier recovery lookup.
    if (syncId) {
      const [existing] = await db
        .select()
        .from(tripLogEntries)
        .where(and(
          eq(tripLogEntries.tripId, tripId),
          eq(tripLogEntries.clientSyncId, syncId),
          eq(tripLogEntries.driverEmployeeId, employee.id),
        ))
        .limit(1);
      if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true });
    }

    // The log entry and its immutable audit event are one durable unit. This
    // prevents a late audit failure from returning HTTP 500 after the log was
    // already saved, which could otherwise produce a duplicate on retry.
    const entryId = randomUUID();
    const sourceChannel = syncId ? 'offline_sync' : 'web';
    try {
      await runAtomicMutations((tx) => [
        tx.insert(tripLogEntries).values({
          id: entryId,
          tripId,
          clientSyncId: syncId,
          driverEmployeeId: employee.id,
          logDate: new Date(`${logDate}T00:00:00+02:00`),
          odometerOut: out,
          odometerIn: incoming,
          departureTime: departureTime ? windhoekDateTime(logDate, departureTime) : null,
          arrivalTime: arrivalTime ? windhoekDateTime(logDate, arrivalTime) : null,
          origin: origin || null,
          destination: destination || null,
          distanceKm: calculatedDistance ?? submittedDistance,
          remarks: remarks || null,
          isSynced: true,
          syncState: 'synced',
        }),
        tx.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'trip_log_created',
          actorUserId: session.user.id,
          action: 'create',
          entityType: 'trip_log_entry',
          entityId: entryId,
          summary: `Driver trip log recorded for ${logDate}`,
          sourceChannel,
        }),
      ]);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '23505' && syncId) {
        const [existing] = await db
          .select()
          .from(tripLogEntries)
          .where(and(
            eq(tripLogEntries.tripId, tripId),
            eq(tripLogEntries.clientSyncId, syncId),
            eq(tripLogEntries.driverEmployeeId, employee.id),
          ))
          .limit(1);
        if (existing) {
          return NextResponse.json({ success: true, data: existing, idempotent: true });
        }
      }
      throw error;
    }

    const [entry] = await db
      .select()
      .from(tripLogEntries)
      .where(eq(tripLogEntries.id, entryId))
      .limit(1);

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    console.error('[TripLogs] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create log entry: ' + String(error) },
      { status: 500 },
    );
  }
}