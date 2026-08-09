import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createScopedNotifications } from '@/lib/notification-service';

/**
 * POST /api/defects/[id]/resolve
 * Resolve a tenant-scoped defect assigned to the current Maintenance Officer.
 * Unassigned defects may be claimed by the first authorised Maintenance Officer
 * who resolves them, so safety work cannot become permanently orphaned.
 * A vehicle blocked by inspection/incident defects is returned to service only
 * when no other unresolved blocking defect remains. Explicit out_of_service
 * and written_off states are never changed here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet/defects', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.MAINTENANCE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const resolutionNotes = typeof body.resolutionNotes === 'string' ? body.resolutionNotes.trim() : '';
    if (!resolutionNotes) {
      return NextResponse.json({ error: 'Resolution notes are required' }, { status: 400 });
    }

    const db = getDb();
    const [defect] = await db
      .select({
        id: vehicleDefects.id,
        vehicleId: vehicleDefects.vehicleId,
        description: vehicleDefects.description,
        isBlocking: vehicleDefects.isBlocking,
        reportedByUserId: vehicleDefects.reportedByUserId,
        assignedToUserId: vehicleDefects.assignedToUserId,
        resolvedAt: vehicleDefects.resolvedAt,
      })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(and(
        eq(vehicleDefects.id, id),
        eq(vehicles.tenantId, session.tenantId),
        or(
          eq(vehicleDefects.assignedToUserId, session.user.id),
          isNull(vehicleDefects.assignedToUserId),
        )!,
      ))
      .limit(1);

    if (!defect) return NextResponse.json({ error: 'Assigned or unassigned defect not found' }, { status: 404 });
    if (defect.resolvedAt) return NextResponse.json({ success: true, alreadyResolved: true });

    const auditId = randomUUID();
    const statusEventId = randomUUID();
    const auditAfter = JSON.stringify({
      vehicleId: defect.vehicleId,
      isBlocking: defect.isBlocking,
      assignedToUserId: defect.assignedToUserId ?? session.user.id,
      resolutionNotes,
    });

    const committed = await db.execute(sql`
      WITH resolved AS (
        UPDATE vehicle_defects d
        SET assigned_to_user_id = coalesce(d.assigned_to_user_id, ${session.user.id}),
            resolved_at = now(),
            resolved_by_user_id = ${session.user.id},
            resolution_notes = ${resolutionNotes},
            updated_at = now()
        FROM vehicles v
        WHERE d.id = ${id}::uuid
          AND d.vehicle_id = v.id
          AND v.tenant_id = ${session.tenantId}::uuid
          AND (d.assigned_to_user_id = ${session.user.id} OR d.assigned_to_user_id IS NULL)
          AND d.resolved_at IS NULL
        RETURNING d.id, d.vehicle_id, d.is_blocking
      ),
      released AS (
        UPDATE vehicles v
        SET status = 'available',
            updated_at = now(),
            updated_by = ${session.user.id}
        FROM resolved r
        WHERE v.id = r.vehicle_id
          AND r.is_blocking = true
          AND v.tenant_id = ${session.tenantId}::uuid
          AND v.status = 'maintenance'
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects other
            WHERE other.vehicle_id = v.id
              AND other.id <> ${id}::uuid
              AND other.is_blocking = true
              AND other.resolved_at IS NULL
          )
        RETURNING v.id
      ),
      status_logged AS (
        INSERT INTO vehicle_status_events (
          id, vehicle_id, previous_status, new_status, reason,
          changed_by_user_id, reference_entity_type, reference_entity_id, created_at
        )
        SELECT
          ${statusEventId}::uuid, r.id, 'maintenance', 'available',
          ${`Blocking defect resolved: ${defect.description}`},
          ${session.user.id}, 'defect', ${id}, now()
        FROM released r
        RETURNING id
      ),
      audit_logged AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, correlation_id, source_channel,
          summary, after, created_at
        )
        SELECT
          ${auditId}::uuid, ${session.tenantId}::uuid, ${Date.now()},
          'vehicle_defect_resolved', ${session.user.id}, 'resolve',
          'vehicle_defect', ${id}::uuid, ${id}, 'web',
          ${`Resolved defect: ${defect.description}`}, ${auditAfter}::jsonb, now()
        FROM resolved
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM resolved)::int AS resolved_count,
        (SELECT count(*) FROM released)::int AS released_count,
        (SELECT count(*) FROM audit_logged)::int AS audit_count
    `);

    const row = committed.rows?.[0] as { resolved_count?: number | string; released_count?: number | string; audit_count?: number | string } | undefined;
    const resolvedCount = Number(row?.resolved_count ?? 0);
    const releasedCount = Number(row?.released_count ?? 0);
    const auditCount = Number(row?.audit_count ?? 0);
    if (resolvedCount !== 1 || auditCount !== 1) {
      const [latest] = await db.select({
        assignedToUserId: vehicleDefects.assignedToUserId,
        resolvedAt: vehicleDefects.resolvedAt,
      }).from(vehicleDefects).where(and(
        eq(vehicleDefects.id, id),
        or(
          eq(vehicleDefects.assignedToUserId, session.user.id),
          isNull(vehicleDefects.assignedToUserId),
        )!,
      )).limit(1);
      if (latest?.resolvedAt && latest.assignedToUserId === session.user.id) {
        return NextResponse.json({ success: true, alreadyResolved: true });
      }
      return NextResponse.json({ error: 'The defect changed while it was being resolved. Refresh and try again.' }, { status: 409 });
    }

    if (defect.reportedByUserId && defect.reportedByUserId !== session.user.id) {
      try {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [defect.reportedByUserId],
          category: 'outcome',
          eventType: 'vehicle_defect_resolved',
          title: 'Reported Defect Resolved',
          body: releasedCount === 1
            ? `${defect.description} Vehicle returned to available status.`
            : defect.description,
          entityType: 'vehicle_defect',
          entityId: id,
          actionUrl: null,
          workspace: null,
          priority: 'normal',
        });
      } catch (error) {
        console.error('[defects/resolve] Notification failed after commit:', error);
      }
    }

    return NextResponse.json({
      success: true,
      alreadyResolved: false,
      claimed: defect.assignedToUserId === null,
      vehicleReleased: releasedCount === 1,
    });
  } catch (error) {
    console.error('[defects/resolve] POST failed:', error);
    return NextResponse.json({ error: 'Failed to resolve defect' }, { status: 500 });
  }
}
