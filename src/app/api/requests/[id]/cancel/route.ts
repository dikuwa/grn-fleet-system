import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { trips } from '@/db/schema/trips';
import { eq, and, sql } from 'drizzle-orm';
import {
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
  requireAnyPermission,
} from '@/lib/auth-helpers';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
import { Permissions } from '@/lib/permissions';
import { notifyRequestCancelled } from '@/lib/request-lifecycle-notifications';
import { resolveActionNotifications } from '@/lib/notification-service';

/**
 * PATCH /api/requests/[id]/cancel
 *
 * Full request cancellation. This is distinct from cancelling one allocation
 * for reallocation: the request, active allocation, pending operational trip,
 * authority and workflow are terminated together.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requireAnyPermission(session, [
      Permissions.REQUEST_CANCEL,
      Permissions.REQUEST_WITHDRAW,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5) {
      return NextResponse.json(
        { error: 'A cancellation reason of at least 5 characters is required.' },
        { status: 400 },
      );
    }
    if (reason.length > 500) {
      return NextResponse.json(
        { error: 'Cancellation reason must be 500 characters or fewer.' },
        { status: 422 },
      );
    }
    const db = getDb();

    const [req] = await db
      .select({
        id: transportRequests.id,
        status: transportRequests.status,
        requesterUserId: transportRequests.requesterUserId,
        workflowInstanceId: transportRequests.workflowInstanceId,
      })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
      .limit(1);

    if (!req) return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    if (req.requesterUserId !== session.user.id) {
      const adminPermission = await requirePermission(session, Permissions.REQUEST_CANCEL);
      if (adminPermission instanceof NextResponse) return adminPermission;
    }

    const nonCancellableStatuses = ['closed', 'cancelled', 'in_progress', 'vehicle_issued'];
    if (nonCancellableStatuses.includes(req.status)) {
      return NextResponse.json(
        { error: `Cannot cancel a request with status: ${req.status}` },
        { status: 409 },
      );
    }

    const [startedTrip] = await db
      .select({ id: trips.id, status: trips.status, issuedAt: trips.issuedAt })
      .from(trips)
      .where(and(eq(trips.requestId, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (startedTrip && (startedTrip.issuedAt || startedTrip.status !== 'pending')) {
      return NextResponse.json(
        {
          error:
            'This request has entered trip operations and can no longer be cancelled from the request workflow.',
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const auditSequence = Date.now();

    // Re-check operational safety inside the same database statement that
    // claims the request. Every dependent cancellation is chained to that
    // claim, so a concurrent issue/start/status change cannot leave request,
    // allocation, trip, authority, external driver, workflow or governed
    // Trip Authority document in conflicting states.
    await db.execute(sql`
      WITH request_claim AS (
        UPDATE transport_requests
        SET status = 'cancelled',
            assigned_driver_employee_id = NULL,
            assigned_driver_external_party_id = NULL,
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = ${req.status}
          AND NOT EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.request_id = ${id}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND (t.issued_at IS NOT NULL OR t.status <> 'pending')
          )
        RETURNING id, workflow_instance_id
      ),
      allocation_cancel AS (
        UPDATE vehicle_allocations
        SET state = 'cancelled', updated_at = ${nowIso}::timestamptz
        WHERE request_id = ${id}::uuid
          AND state IN ('provisional', 'confirmed')
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      external_assignment_cancel AS (
        UPDATE external_driver_assignments eda
        SET state = 'cancelled',
            cancelled_at = ${nowIso}::timestamptz,
            cancellation_reason = ${reason},
            updated_at = ${nowIso}::timestamptz
        WHERE eda.tenant_id = ${session.tenantId}::uuid
          AND eda.request_id = ${id}::uuid
          AND eda.state IN ('pending_acceptance', 'accepted')
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING eda.id
      ),
      external_request_driver_reset AS (
        UPDATE external_request_drivers erd
        SET is_confirmed = false,
            driver_type = 'nominated'
        WHERE erd.request_id = ${id}::uuid
          AND EXISTS (SELECT 1 FROM external_assignment_cancel)
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING erd.id
      ),
      trip_cancel AS (
        UPDATE trips
        SET status = 'cancelled', updated_at = ${nowIso}::timestamptz
        WHERE request_id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      authority_cancel AS (
        UPDATE trip_authorities
        SET status = 'cancelled', cancelled_at = ${nowIso}::timestamptz, cancellation_reason = ${reason}, updated_at = ${nowIso}::timestamptz
        WHERE request_id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      generated_authority_cancel AS (
        UPDATE generated_documents gd
        SET status = 'cancelled',
            reason = ${reason},
            updated_at = ${nowIso}::timestamptz
        WHERE gd.tenant_id = ${session.tenantId}::uuid
          AND gd.entity_type = 'vehicle_allocation'
          AND gd.entity_id IN (
            SELECT va.id
            FROM vehicle_allocations va
            WHERE va.request_id = ${id}::uuid
          )
          AND gd.document_type = 'trip_authority'
          AND gd.status IN ('draft', 'issued')
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING gd.id
      ),
      driver_reset AS (
        UPDATE request_drivers
        SET is_confirmed = false
        WHERE request_id = ${id}::uuid
          AND EXISTS (SELECT 1 FROM request_claim)
        RETURNING id
      ),
      workflow_cancel AS (
        UPDATE workflow_instances wi
        SET status = 'cancelled', updated_at = ${nowIso}::timestamptz
        FROM request_claim rc
        WHERE rc.workflow_instance_id IS NOT NULL
          AND wi.id = rc.workflow_instance_id
        RETURNING wi.id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, reason, source_channel,
          before, after, summary
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'request_cancelled',
          ${session.user.id},
          'cancel',
          'transport_request',
          ${id}::uuid,
          ${reason},
          'web',
          jsonb_build_object('status', ${req.status}::text),
          jsonb_build_object('status', 'cancelled'::text),
          ${`Transport request cancelled from ${req.status}`}
        FROM request_claim
        RETURNING id
      )
      SELECT 1 / (
        (SELECT count(*)::integer FROM request_claim) *
        (SELECT count(*)::integer FROM audit_insert)
      ) AS committed
    `);

    if (req.workflowInstanceId) {
      await resolveActionNotifications({
        tenantId: session.tenantId,
        entityType: 'workflow_instance',
        entityId: req.workflowInstanceId,
      }).catch((notificationError) => {
        console.warn('[requests/cancel] Could not resolve cancelled workflow notifications:', notificationError);
      });
    }

    await notifyRequestCancelled({
      tenantId: session.tenantId,
      requestId: id,
      actorUserId: session.user.id,
      reason,
    }).catch((notificationError) => {
      console.warn('[request-cancel] Post-commit lifecycle notification failed:', notificationError);
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (error) {
    console.error('Cancel request failed:', error);
    const { message } = getDatabaseErrorDetails(error);
    if (message.includes('division by zero') || message.includes('atomic_request_cancel_failed')) {
      return NextResponse.json(
        {
          error:
            'This request changed or entered trip operations while cancellation was being saved. Refresh and review the latest status.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Cancel request failed' }, { status: 500 });
  }
}
