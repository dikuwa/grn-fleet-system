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

    const alreadyAtTarget = vehicle.status === targetStatus;

    // Vehicle mutation and status-history creation must succeed together. Claim
    // the exact status that was reviewed before applying the transition so a
    // stale decommission request cannot silently overwrite a newer lifecycle
    // decision after waiting on the row lock. Same-state retries remain no-op
    // and do not create duplicate status-history rows.
    await db.execute(sql`
      WITH candidate AS (
        SELECT id, status, notes
        FROM vehicles
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = ${vehicle.status}
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
          AND c.status <> ${targetStatus}
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
            'Vehicle lifecycle state changed while decommissioning was being processed. Refresh the vehicle and review its current status before retrying.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      idempotentReplay: alreadyAtTarget,
      data: {
        vehicle: updated,
        event: alreadyAtTarget
          ? null
          : { previousStatus: vehicle.status, newStatus: targetStatus, reason },
      },
    });
  } catch (error) {
    console.error('[fleet/decommission] POST failed:', error);
    return NextResponse.json({ error: 'Failed to decommission vehicle' }, { status: 500 });
  }
}
