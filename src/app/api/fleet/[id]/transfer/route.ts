import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql } from 'drizzle-orm';

/**
 * POST /api/fleet/[id]/transfer
 *
 * Transfer a vehicle to a different office within the same tenant.
 * Records the transfer in status events and updates the vehicle's
 * assigned office.
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

    const [vehicle] = await db
      .select({
        id: vehicles.id,
        status: vehicles.status,
        officeId: vehicles.officeId,
        assignedOfficeId: vehicles.assignedOfficeId,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const body = await req.json();
    const targetOfficeId = String(body.officeId || '').trim();
    if (!targetOfficeId) {
      return NextResponse.json({ error: 'Target office ID is required' }, { status: 400 });
    }

    // Verify target office exists and belongs to this tenant.
    const [targetOffice] = await db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.id, targetOfficeId), eq(offices.tenantId, session.tenantId)))
      .limit(1);

    if (!targetOffice) {
      return NextResponse.json({ error: 'Target office not found in your tenant' }, { status: 404 });
    }

    // Same-target retries are idempotent and do not append duplicate transfer history.
    if (vehicle.officeId === targetOfficeId && vehicle.assignedOfficeId === targetOfficeId) {
      return NextResponse.json({
        success: true,
        idempotentReplay: true,
        data: {
          vehicle,
          previousOfficeId: vehicle.officeId,
          newOfficeId: targetOfficeId,
          officeName: targetOffice.name,
        },
      });
    }

    if (['allocated', 'issued'].includes(vehicle.status)) {
      return NextResponse.json(
        {
          error:
            'Cannot transfer a vehicle while it has an active allocation or has been issued. Complete, cancel, or replace the operational assignment first.',
        },
        { status: 409 },
      );
    }

    const reason = String(body.reason || '').trim() || `Transfer to ${targetOffice.name}`;
    const transferNote = `[TRANSFERRED TO ${targetOffice.name}: ${reason}]`;

    // Lock and re-check vehicle state inside the mutation. The vehicle update and
    // status-history row are one SQL statement, preventing a false audit event or
    // an office change racing with a newly-created allocation/issue state.
    await db.execute(sql`
      WITH candidate AS (
        SELECT id, status, office_id, assigned_office_id, notes
        FROM vehicles
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
        FOR UPDATE
      ),
      transitioned AS (
        UPDATE vehicles AS v
        SET office_id = ${targetOfficeId}::uuid,
            assigned_office_id = ${targetOfficeId}::uuid,
            updated_by = ${session.user.id},
            updated_at = NOW(),
            notes = CASE
              WHEN c.notes IS NULL OR c.notes = '' THEN ${transferNote}
              ELSE c.notes || E'\n' || ${transferNote}
            END
        FROM candidate AS c
        WHERE v.id = c.id
          AND c.status NOT IN ('allocated', 'issued')
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
        previous_status,
        ${`TRANSFER: ${reason}`},
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
    if (updated.officeId !== targetOfficeId || updated.assignedOfficeId !== targetOfficeId) {
      return NextResponse.json(
        {
          error:
            'Vehicle operational state changed while the transfer was being processed. Refresh and complete the active allocation or trip first.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      idempotentReplay: false,
      data: {
        vehicle: updated,
        previousOfficeId: vehicle.officeId,
        newOfficeId: targetOfficeId,
        officeName: targetOffice.name,
      },
    });
  } catch (error) {
    console.error('[fleet/transfer] POST failed:', error);
    return NextResponse.json({ error: 'Failed to transfer vehicle' }, { status: 500 });
  }
}
