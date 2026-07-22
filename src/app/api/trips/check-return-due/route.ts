/**
 * Return Due Check API
 *
 * POST /api/trips/check-return-due — Check all in-progress trips and mark overdue
 * ones as return_due based on their allocation end time.
 *
 * This is intended to be called by a cron job (e.g. Inngest) but can also be
 * invoked manually by admins.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, lt, sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const tenantId = session.tenantId;
    const now = new Date();

    // Find all in_progress trips where the allocation end time has passed
    const overdueTrips = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(trips)
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .where(
        and(
          eq(trips.tenantId, tenantId),
          eq(trips.status, 'in_progress'),
          lt(vehicleAllocations.endAt, now),
        ),
      );

    if (overdueTrips.length === 0) {
      return NextResponse.json({
        success: true,
        checked: true,
        overdueCount: 0,
        updatedTrips: [],
      });
    }

    // Update all overdue trips to return_due (re-verify status === 'in_progress' to avoid race conditions)
    const overdueIds = overdueTrips.map((t) => t.id);
    await db
      .update(trips)
      .set({
        status: 'return_due',
        updatedAt: now,
      })
      .where(
        and(
          eq(trips.tenantId, tenantId),
          eq(trips.status, 'in_progress'),
          sql`${trips.id} = ANY(${overdueIds}::uuid[])`,
        ),
      );

    // Log audit events for each overdue trip
    for (const trip of overdueTrips) {
      await db.insert(auditEvents).values({
        tenantId,
        tenantSequence: 0,
        eventType: 'trip_return_due',
        actorUserId: session.user.id,
        action: 'system_flag',
        entityType: 'trip',
        entityId: trip.id,
        summary: `Trip flagged return_due: ${trip.make} ${trip.model} (${trip.licenceNumber}) — allocation ended at ${trip.endAt?.toISOString()}`,
        sourceChannel: 'system',
      });

      // Log vehicle status event
      await db.insert(vehicleStatusEvents).values({
        vehicleId: trip.vehicleId,
        previousStatus: 'allocated',
        newStatus: 'return_due',
        reason: `Allocation period ended. Trip flagged as return_due.`,
        changedByUserId: session.user.id,
        referenceEntityType: 'trip',
        referenceEntityId: trip.id,
      });
    }

    return NextResponse.json({
      success: true,
      checked: true,
      overdueCount: overdueTrips.length,
      updatedTrips: overdueTrips.map((t) => ({
        id: t.id,
        vehicle: `${t.make} ${t.model}`,
        licence: t.licenceNumber,
        allocationEnd: t.endAt?.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[trips/check-return-due] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to check return due trips' },
      { status: 500 },
    );
  }
}
