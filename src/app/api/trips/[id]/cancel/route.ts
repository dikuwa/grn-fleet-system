import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { createScopedNotifications, resolveActionNotifications } from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { WorkspaceIds } from '@/lib/workspaces';

/** Cancel an authorised trip before physical issue/departure. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || '';
    if (reason.length < 10) {
      return NextResponse.json({ error: 'A cancellation reason of at least 10 characters is required.' }, { status: 422 });
    }
    if (reason.length > 500) {
      return NextResponse.json({ error: 'Cancellation reason must be 500 characters or fewer.' }, { status: 422 });
    }

    const db = getDb();
    const [context] = await db
      .select({
        tripId: trips.id,
        tripStatus: trips.status,
        issuedAt: trips.issuedAt,
        allocationId: vehicleAllocations.id,
        allocationState: vehicleAllocations.state,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestId: transportRequests.id,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        requesterUserId: transportRequests.requesterUserId,
        workflowInstanceId: transportRequests.workflowInstanceId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(
        eq(trips.id, id),
        eq(trips.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(tripAuthorities.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!context) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 });
    if (context.tripStatus === 'cancelled') {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }
    if (context.tripStatus !== 'pending' || context.issuedAt) {
      return NextResponse.json(
        { error: 'Only a pending trip that has not been physically issued can be cancelled here.' },
        { status: 409 },
      );
    }
    if (!['provisional', 'confirmed'].includes(context.allocationState)) {
      return NextResponse.json({ error: `Allocation cannot be cancelled from ${context.allocationState}.` }, { status: 409 });
    }

    const now = new Date();
    const auditSequence = Date.now();
    const beforeJson = JSON.stringify({
      tripStatus: context.tripStatus,
      allocationState: context.allocationState,
      requestStatus: context.requestStatus,
      authorityStatus: context.authorityStatus,
    });
    const afterJson = JSON.stringify({
      tripStatus: 'cancelled',
      allocationState: 'cancelled',
      requestStatus: 'cancelled',
      authorityStatus: 'cancelled',
    });

    await db.execute(sql`
      WITH trip_claim AS (
        UPDATE trips t
        SET status = 'cancelled', updated_at = ${now}
        WHERE t.id = ${id}::uuid
          AND t.tenant_id = ${session.tenantId}::uuid
          AND t.status = 'pending'
          AND t.issued_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM vehicle_allocations va
            WHERE va.id = t.allocation_id
              AND va.state IN ('provisional', 'confirmed')
          )
        RETURNING t.id, t.request_id, t.allocation_id
      ),
      allocation_updated AS (
        UPDATE vehicle_allocations va
        SET state = 'cancelled', override_reason = ${reason}, updated_at = ${now}
        FROM trip_claim tc
        WHERE va.id = tc.allocation_id
          AND va.state IN ('provisional', 'confirmed')
        RETURNING va.id
      ),
      authority_updated AS (
        UPDATE trip_authorities ta
        SET status = 'cancelled',
            cancelled_at = ${now},
            cancellation_reason = ${reason},
            updated_at = ${now}
        FROM trip_claim tc
        WHERE ta.id = ${context.authorityId}::uuid
          AND ta.trip_id = tc.id
          AND ta.tenant_id = ${session.tenantId}::uuid
          AND ta.status <> 'cancelled'
        RETURNING ta.id
      ),
      generated_authority_updated AS (
        UPDATE generated_documents gd
        SET status = 'cancelled',
            reason = ${reason},
            updated_at = ${now}
        FROM trip_claim tc
        WHERE gd.tenant_id = ${session.tenantId}::uuid
          AND gd.entity_type = 'vehicle_allocation'
          AND gd.entity_id = tc.allocation_id
          AND gd.document_type = 'trip_authority'
          AND gd.status IN ('draft', 'issued')
        RETURNING gd.id
      ),
      request_updated AS (
        UPDATE transport_requests tr
        SET status = 'cancelled', updated_at = ${now}
        FROM trip_claim tc
        WHERE tr.id = tc.request_id
          AND tr.tenant_id = ${session.tenantId}::uuid
          AND tr.status <> 'cancelled'
        RETURNING tr.id
      ),
      workflow_updated AS (
        UPDATE workflow_instances wi
        SET status = 'cancelled', updated_at = ${now}
        FROM request_updated ru
        WHERE ${context.workflowInstanceId}::uuid IS NOT NULL
          AND wi.id = ${context.workflowInstanceId}::uuid
          AND wi.request_id = ru.id
          AND wi.status = 'active'
        RETURNING wi.id
      ),
      audit_inserted AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, reason, before, after, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'trip_cancelled',
          ${session.user.id},
          'trip.cancel',
          'trip',
          tc.id,
          ${`Trip cancelled for request ${context.requestReference}`},
          ${reason},
          ${beforeJson}::jsonb,
          ${afterJson}::jsonb,
          'web'
        FROM trip_claim tc
        INNER JOIN allocation_updated au ON true
        INNER JOIN authority_updated tu ON true
        INNER JOIN request_updated ru ON ru.id = tc.request_id
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM allocation_updated) = 1
         AND (SELECT count(*) FROM authority_updated) = 1
         AND (SELECT count(*) FROM request_updated) = 1
         AND (SELECT count(*) FROM audit_inserted) = 1
        THEN '1'
        ELSE 'atomic_trip_cancel_failed_'
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM allocation_updated)::text
          || (SELECT count(*) FROM authority_updated)::text
          || (SELECT count(*) FROM request_updated)::text
          || (SELECT count(*) FROM audit_inserted)::text
      END AS integer) AS committed
    `);

    if (context.workflowInstanceId) {
      await resolveActionNotifications({
        tenantId: session.tenantId,
        entityType: 'workflow_instance',
        entityId: context.workflowInstanceId,
        eventTypes: ['driver_acknowledgement_required', 'approval_assigned'],
      }).catch(() => undefined);
    }

    const recipientUserIds = new Set<string>();
    if (context.requesterUserId && context.requesterUserId !== session.user.id) recipientUserIds.add(context.requesterUserId);
    if (context.driverEmployeeId) {
      const [driver] = await db
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, context.driverEmployeeId), eq(employees.tenantId, session.tenantId)))
        .limit(1);
      if (driver?.userId && driver.userId !== session.user.id) recipientUserIds.add(driver.userId);
    }
    if (recipientUserIds.size) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [...recipientUserIds],
        category: 'outcome',
        eventType: 'trip_cancelled',
        title: 'Trip cancelled',
        body: `Request ${context.requestReference} has been cancelled. Reason: ${reason}`,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/trips/${id}`,
        workspace: WorkspaceIds.PERSONAL,
        priority: 'high',
      }).catch(() => undefined);
    }

    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: context.requestId,
      reference: context.requestReference,
      stage: 'cancelled',
      officeLabel: 'Transport office',
    }).catch(() => undefined);

    return NextResponse.json({ success: true, alreadyCancelled: false });
  } catch (error) {
    console.error('[trips/cancel] POST failed:', error);
    if (String(error).includes('atomic_trip_cancel_failed')) {
      return NextResponse.json(
        { error: 'Trip state changed while cancellation was being recorded. Refresh and review the latest state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Trip cancellation failed. Refresh and try again.' }, { status: 500 });
  }
}
