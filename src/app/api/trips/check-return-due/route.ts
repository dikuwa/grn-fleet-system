/**
 * Return Due Check API
 *
 * POST /api/trips/check-return-due — Check the current tenant's in-progress
 * trips and mark overdue ones as return_due based on allocation end time.
 *
 * This endpoint is an authenticated Transport Operations action. A future
 * scheduler should call the underlying domain service through a dedicated
 * service-authenticated path rather than bypassing dashboard authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { eq, and, lt, sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // This is a tenant-wide operational mutation, so a broad permission alone
    // must not make it callable from assigned/self workspaces.
    const routeCheck = await requireDashboardAction(session, '/dashboard/trips/active', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const tenantId = session.tenantId;
    const now = new Date();

    // Find all in-progress trips where the confirmed allocation period has
    // ended. Tenant-owned vehicle joins are explicit so presentation metadata
    // cannot cross tenant boundaries even if bad historical data exists.
    const overdueTrips = await db
      .select({
        id: trips.id,
        vehicleId: trips.vehicleId,
        endAt: vehicleAllocations.endAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(
        vehicles,
        and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)),
      )
      .where(
        and(
          eq(trips.tenantId, tenantId),
          eq(trips.status, 'in_progress'),
          eq(vehicleAllocations.state, 'confirmed'),
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

    const overdueIds = overdueTrips.map((trip) => trip.id);

    // The trip transition and its audit rows must commit together. Vehicle
    // status remains issued while a trip is merely overdue; return_due is a
    // trip lifecycle state, not a vehicle lifecycle state.
    await runAtomicMutations((tx) => {
      const queries: any[] = [
        tx
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
          ),
      ];

      for (const trip of overdueTrips) {
        queries.push(
          tx.insert(auditEvents).values({
            tenantId,
            tenantSequence: 0,
            eventType: 'trip_return_due',
            actorUserId: session.user.id,
            action: 'system_flag',
            entityType: 'trip',
            entityId: trip.id,
            summary: `Trip flagged return_due: ${trip.make} ${trip.model} (${trip.licenceNumber}) — allocation ended at ${trip.endAt.toISOString()}`,
            sourceChannel: 'system',
          }),
        );
      }

      return queries;
    });

    return NextResponse.json({
      success: true,
      checked: true,
      overdueCount: overdueTrips.length,
      updatedTrips: overdueTrips.map((trip) => ({
        id: trip.id,
        vehicle: `${trip.make} ${trip.model}`,
        licence: trip.licenceNumber,
        allocationEnd: trip.endAt.toISOString(),
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
