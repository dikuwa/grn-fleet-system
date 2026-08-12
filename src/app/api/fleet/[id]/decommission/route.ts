import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql } from 'drizzle-orm';

/**
 * POST /api/fleet/[id]/decommission
 *
 * Decommission a vehicle — marks it as written_off or out_of_service
 * with a reason and audit trail. Prevents decommission of vehicles
 * that are currently on active trips.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;

    // Verify vehicle exists and belongs to this tenant.
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const body = await req.json();
    const targetStatus = body.status || 'written_off';
    if (!['written_off', 'out_of_service'].includes(targetStatus)) {
      return NextResponse.json(
        { error: 'Decommission status must be "written_off" or "out_of_service"' },
        { status: 400 },
      );
    }

    const reason = String(body.reason || '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'Decommission reason is required' }, { status: 400 });
    }

    // Same-state retries are safe and do not create duplicate history rows.
    if (vehicle.status === targetStatus) {
      return NextResponse.json({
        success: true,
        idempotentReplay: true,
        data: { vehicle, event: null },
      });
    }

    // Vehicle mutation and status-history creation must succeed together. The
    // candidate row is locked and the UPDATE re-checks operational status inside
    // the same statement, so an allocation/issue race cannot be overwritten by
    // a stale preflight read.
    await db.execute(sql`
      WITH candidate AS (
        SELECT id, status, notes
        FROM vehicles
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
        FOR UPDATE
      ),
      transitioned AS (
        UPDATE vehicles AS v
        SET status = ${targetStatus},
            is_active = ${targetStatus === 'out_of_service'},
            notes = CASE
              WHEN c.notes IS NULL OR c.notes = '' THEN ${`[DECOMMISSIONED: ${reason}]`}
              ELSE c.notes || E'\n' || ${`[DECOMMISSIONED: ${reason}]`}
            END,
            updated_by = ${session.user.id},
            updated_at = NOW()
        FROM candidate AS c
        WHERE v.id = c.id
          AND c.status NOT IN ('issued', 'allocated')
        RETURNING v.id, c.status AS previous_status
      )
      INSERT INTO vehicle_status_events (
        vehicle_id,
        previous_status,
        new_status,
        reason,
        changed_by_user_id
      )
      SELECT
        id,
        previous_status,
        ${targetStatus},
        ${reason},
        ${session.user.id}
      FROM transitioned
    `);

    const [updated] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!updated) {
      return NextResponse.json({ error: 'Vehicle no longer exists' }, { status: 404 });
    }
    if (updated.status !== targetStatus) {
      return NextResponse.json(
        {
          error:
            'Cannot decommission a vehicle that is currently on an active trip or allocation. Complete or cancel the operational workflow first.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      idempotentReplay: false,
      data: {
        vehicle: updated,
        event: { previousStatus: vehicle.status, newStatus: targetStatus, reason },
      },
    });
  } catch (error) {
    console.error('[fleet/decommission] POST failed:', error);
    return NextResponse.json({ error: 'Failed to decommission vehicle' }, { status: 500 });
  }
}
