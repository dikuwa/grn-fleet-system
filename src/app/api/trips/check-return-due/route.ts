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
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, lt, inArray, sql } from 'drizzle-orm';

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

    // Resolve candidates for a useful response, but do not trust this snapshot
    // for the mutation itself. The write below re-checks every lifecycle guard.
    const candidates = await db
      .select({ id: trips.id })
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

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        checked: true,
        overdueCount: 0,
        updatedTrips: [],
      });
    }

    // Claim only rows that are still genuinely overdue at write time, then
    // create audit events from those claimed rows in the same SQL statement.
    // This prevents a concurrent return from producing a false return_due audit.
    await db.execute(sql`
      WITH overdue_claim AS (
        UPDATE trips AS t
        SET status = 'return_due', updated_at = ${now}
        FROM vehicle_allocations AS va, vehicles AS v
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.status = 'in_progress'
          AND va.id = t.allocation_id
          AND va.state = 'confirmed'
          AND va.end_at < ${now}
          AND v.id = t.vehicle_id
          AND v.tenant_id = ${tenantId}::uuid
        RETURNING t.id, t.vehicle_id, t.allocation_id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, source_channel
        )
        SELECT
          ${tenantId}::uuid,
          (extract(epoch from clock_timestamp()) * 1000000)::bigint + row_number() OVER (),
          'trip_return_due',
          ${session.user.id},
          'system_flag',
          'trip',
          claim.id,
          'Trip flagged return_due: ' || v.make || ' ' || v.model || ' (' || v.licence_number ||
            ') — allocation ended at ' || va.end_at::text,
          'system'
        FROM overdue_claim claim
        INNER JOIN vehicle_allocations va ON va.id = claim.allocation_id
        INNER JOIN vehicles v ON v.id = claim.vehicle_id AND v.tenant_id = ${tenantId}::uuid
        RETURNING entity_id
      )
      SELECT count(*) AS updated_count FROM audit_insert
    `);

    const candidateIds = candidates.map((trip) => trip.id);
    const updatedTrips = await db
      .select({
        id: trips.id,
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
          eq(trips.status, 'return_due'),
          inArray(trips.id, candidateIds),
        ),
      );

    return NextResponse.json({
      success: true,
      checked: true,
      overdueCount: updatedTrips.length,
      updatedTrips: updatedTrips.map((trip) => ({
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
