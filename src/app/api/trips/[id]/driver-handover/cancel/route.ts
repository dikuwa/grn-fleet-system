import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAuthorities, tripAuthorisedDrivers, trips } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requireAnyPermission(session, [
      Permissions.ALLOCATION_MANAGE,
      Permissions.TRIP_MANAGE,
    ]);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id: tripId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = String(body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) {
      return NextResponse.json({ error: 'Cancellation reason must be 10–500 characters' }, { status: 422 });
    }

    const db = getDb();
    const [pending] = await db
      .select({
        handoverId: tripAuthorisedDrivers.id,
        authorityId: tripAuthorities.id,
        authorityVersion: tripAuthorities.version,
        reliefEmployeeId: employees.id,
        reliefUserId: employees.userId,
        reliefFirstName: employees.firstName,
        reliefLastName: employees.lastName,
        requestReference: transportRequests.reference,
      })
      .from(tripAuthorisedDrivers)
      .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAuthorisedDrivers.authorityId))
      .innerJoin(trips, eq(trips.id, tripAuthorities.tripId))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
      .where(
        and(
          eq(trips.id, tripId),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
          eq(employees.tenantId, session.tenantId),
          eq(tripAuthorisedDrivers.driverType, 'relief'),
          isNull(tripAuthorisedDrivers.acknowledgedAt),
        ),
      )
      .limit(1);

    if (!pending) {
      return NextResponse.json({ error: 'There is no pending relief-driver handover to cancel' }, { status: 404 });
    }

    const now = new Date();
    await db.execute(sql`
      WITH handover_claim AS (
        UPDATE trip_authorised_drivers
        SET driver_type = 'relief_cancelled'
        WHERE id = ${pending.handoverId}::uuid
          AND authority_id = ${pending.authorityId}::uuid
          AND driver_type = 'relief'
          AND acknowledged_at IS NULL
        RETURNING id
      ),
      authority_update AS (
        UPDATE trip_authorities
        SET version = version + 1,
            document_version = document_version + 1,
            updated_at = ${now}
        WHERE id = ${pending.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND version = ${pending.authorityVersion}
          AND EXISTS (SELECT 1 FROM handover_claim)
        RETURNING *
      ),
      amendment_insert AS (
        INSERT INTO trip_amendments (
          authority_id, amendment_type, original_value, new_value, reason,
          status, requested_by_user_id, approved_by_user_id, approved_at, version
        )
        SELECT
          id,
          'driver_handover_cancelled',
          jsonb_build_object('reliefDriverEmployeeId', ${pending.reliefEmployeeId}::text),
          jsonb_build_object('state', 'cancelled'),
          ${reason},
          'approved',
          ${session.user.id},
          ${session.user.id},
          ${now},
          version
        FROM authority_update
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, reason, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${Date.now()},
          'trip_driver_handover_cancelled',
          ${session.user.id},
          'cancel_driver_handover',
          'trip',
          ${tripId}::uuid,
          ${`Pending relief-driver handover cancelled for ${pending.requestReference}`},
          ${reason},
          'web'
        FROM amendment_insert
        RETURNING id
      )
      SELECT (SELECT count(*) FROM audit_insert) AS committed
    `);

    const [stillPending] = await db
      .select({ id: tripAuthorisedDrivers.id })
      .from(tripAuthorisedDrivers)
      .where(
        and(
          eq(tripAuthorisedDrivers.id, pending.handoverId),
          eq(tripAuthorisedDrivers.driverType, 'relief'),
          isNull(tripAuthorisedDrivers.acknowledgedAt),
        ),
      )
      .limit(1);
    if (stillPending) {
      return NextResponse.json({ error: 'The handover changed while cancellation was being saved' }, { status: 409 });
    }

    if (pending.reliefUserId) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [pending.reliefUserId],
        category: 'information',
        eventType: 'driver_handover_cancelled',
        title: 'Driver handover cancelled',
        body: `${pending.requestReference}: the proposed driver handover was cancelled by Transport Administration.`,
        entityType: 'trip',
        entityId: tripId,
        actionUrl: '/dashboard/driver-mobile',
        workspace: WorkspaceIds.DRIVER,
        priority: 'normal',
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      reliefDriver: `${pending.reliefFirstName} ${pending.reliefLastName}`.trim(),
    });
  } catch (error) {
    console.error('[trips/driver-handover/cancel] POST failed:', error);
    return NextResponse.json({ error: 'Pending driver handover could not be cancelled' }, { status: 500 });
  }
}
