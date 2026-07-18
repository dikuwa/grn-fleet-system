/**
 * Trip Log Entries API
 *
 * GET  /api/trip-logs   — List log entries for a trip (requires auth)
 * POST /api/trip-logs   — Create a log entry (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripLogEntries, trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/trip-logs
 * List log entries for a specific trip, or all recent entries.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(request.url);
    const tripId = searchParams.get('tripId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = getDb();

    const conditions = [];

    if (tripId) {
      conditions.push(eq(tripLogEntries.tripId, tripId));
    }

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
      .select({ id: trips.id, tenantId: trips.tenantId })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Trip does not belong to your organisation' }, { status: 403 });
    }

    const [entry] = await db
      .insert(tripLogEntries)
      .values({
        tripId,
        clientSyncId: clientSyncId || null,
        driverEmployeeId: session.user.id, // Will be resolved to employee ID in production
        logDate: new Date(logDate),
        odometerOut: odometerOut ? Number(odometerOut) : null,
        odometerIn: odometerIn ? Number(odometerIn) : null,
        departureTime: departureTime ? new Date(`${logDate}T${departureTime}`) : null,
        arrivalTime: arrivalTime ? new Date(`${logDate}T${arrivalTime}`) : null,
        origin: origin || null,
        destination: destination || null,
        distanceKm: distanceKm ? Number(distanceKm) : null,
        remarks: remarks || null,
        isSynced: true,
        syncState: 'synced',
      })
      .returning();

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    console.error('[TripLogs] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create log entry: ' + String(error) },
      { status: 500 },
    );
  }
}
