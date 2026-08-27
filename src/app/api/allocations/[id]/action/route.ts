/**
 * Allocation Action API
 *
 * POST /api/allocations/[id]/action
 *
 * Actions:
 *   - confirm: confirm a provisional allocation
 *   - cancel: cancel this assignment and return the request to Transport Review
 *   - replace_vehicle: delegate to the canonical replacement service
 *
 * Physical issue and final release are separate trip lifecycle operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, and, sql } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { replaceVehicle, VehicleReplaceError } from '@/lib/allocations/vehicle-replacement';
import { createScopedNotifications } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { actionType, vehicleId: replacementVehicleId, reason, handoverOdometer } = body;
    if (!actionType || !['confirm', 'cancel', 'replace_vehicle'].includes(actionType)) {
      return NextResponse.json({ error: 'actionType must be: confirm, cancel, or replace_vehicle' }, { status: 400 });
    }

    if (actionType === 'replace_vehicle') {
      const result = await replaceVehicle({
        allocationId: id,
        replacementVehicleId,
        reason,
        handoverOdometer: handoverOdometer != null ? Number(handoverOdometer) : null,
      }, session);
      return NextResponse.json(result);
    }

    const db = getDb();
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        version: vehicleAllocations.version,
        vehicleId: vehicleAllocations.vehicleId,
        requestId: vehicleAllocations.requestId,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestStatus: transportRequests.status,
        requestReference: transportRequests.reference,
        requesterUserId: transportRequests.requesterUserId,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(vehicleAllocations.id, id),
        eq(vehicles.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!allocation) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });

    if (actionType === 'confirm') {
      // Confirmation is deliberately idempotent because the operator flow
      // confirms first and then creates the trip. If the second request fails
      // or the browser retries after a lost response, a confirmed allocation
      // must remain usable instead of trapping the operator behind a 409.
      if (allocation.state === 'confirmed') {
        return NextResponse.json({ success: true, state: 'confirmed', alreadyConfirmed: true });
      }
      if (allocation.state !== 'provisional') {
        return NextResponse.json({ error: `Cannot confirm an allocation in '${allocation.state}' state` }, { status: 409 });
      }

      const now = new Date();
      try {
        await db.execute(sql`
          WITH allocation_claim AS (
            UPDATE vehicle_allocations
            SET state = 'confirmed', version = version + 1, updated_at = ${now}
            WHERE id = ${id}::uuid
              AND state = 'provisional'
              AND version = ${allocation.version}
              AND EXISTS (
                SELECT 1
                FROM transport_requests tr
                WHERE tr.id = vehicle_allocations.request_id
                  AND tr.tenant_id = ${session.tenantId}::uuid
              )
            RETURNING id
          ),
          audit_insert AS (
            INSERT INTO audit_events (
              tenant_id, tenant_sequence, event_type, actor_user_id, action,
              entity_type, entity_id, summary, before, after, source_channel
            )
            SELECT
              ${session.tenantId}::uuid,
              ${Date.now()},
              'allocation_confirmed',
              ${session.user.id},
              'confirm',
              'allocation',
              ${id}::uuid,
              ${`Allocation confirmed for request ${allocation.requestReference}`},
              jsonb_build_object('state', 'provisional'),
              jsonb_build_object('state', 'confirmed'),
              'web'
            FROM allocation_claim
            RETURNING id
          )
          SELECT CAST(CASE
            WHEN (SELECT count(*) FROM allocation_claim) = 1
             AND (SELECT count(*) FROM audit_insert) = 1
            THEN '1'
            ELSE 'atomic_allocation_confirm_failed_'
              || (SELECT count(*) FROM allocation_claim)::text
              || (SELECT count(*) FROM audit_insert)::text
          END AS integer) AS committed
        `);
      } catch (mutationError) {
        if (String(mutationError).includes('atomic_allocation_confirm_failed')) {
          return NextResponse.json(
            { error: 'The allocation changed while it was being confirmed. Refresh and review the latest state.' },
            { status: 409 },
          );
        }
        throw mutationError;
      }

      return NextResponse.json({ success: true, state: 'confirmed', alreadyConfirmed: false });
    }

    if (!['provisional', 'confirmed'].includes(allocation.state)) {
      return NextResponse.json({ error: `Cannot cancel an allocation in '${allocation.state}' state` }, { status: 409 });
    }
    const cancellationReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cancellationReason) {
      return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
    }

    const [trip] = await db
      .select({ id: trips.id, status: trips.status, issuedAt: trips.issuedAt })
      .from(trips)
      .where(and(eq(trips.allocationId, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (trip && (trip.issuedAt || trip.status !== 'pending')) {
      return NextResponse.json(
        { error: 'This allocation has entered trip operations. Use the operational replacement/incident workflow instead of cancelling it.' },
        { status: 409 },
      );
    }

    const now = new Date();
    try {
      await db.execute(sql`
        WITH allocation_claim AS (
          UPDATE vehicle_allocations
          SET state = 'cancelled',
              override_reason = ${cancellationReason},
              version = version + 1,
              updated_at = ${now}
          WHERE id = ${id}::uuid
            AND state IN ('provisional', 'confirmed')
            AND version = ${allocation.version}
            AND EXISTS (
              SELECT 1
              FROM transport_requests tr
              WHERE tr.id = vehicle_allocations.request_id
                AND tr.tenant_id = ${session.tenantId}::uuid
            )
            AND NOT EXISTS (
              SELECT 1
              FROM trips t
              WHERE t.allocation_id = vehicle_allocations.id
                AND t.tenant_id = ${session.tenantId}::uuid
                AND (t.issued_at IS NOT NULL OR t.status <> 'pending')
            )
          RETURNING request_id
        ),
        workflow_context AS (
          SELECT
            wi.id AS previous_instance_id,
            wi.request_id,
            wi.definition_id,
            wi.definition_version,
            wi.status AS previous_status,
            wi.routing_context
          FROM allocation_claim ac
          JOIN transport_requests tr
            ON tr.id = ac.request_id
           AND tr.tenant_id = ${session.tenantId}::uuid
          JOIN workflow_instances wi
            ON wi.id = tr.workflow_instance_id
           AND wi.request_id = tr.id
        ),
        transport_review_step AS (
          SELECT
            wc.previous_instance_id,
            wc.request_id,
            wc.definition_id,
            wc.definition_version,
            wc.previous_status,
            wc.routing_context,
            ws.step_order
          FROM workflow_context wc
          JOIN workflow_steps ws
            ON ws.definition_id = wc.definition_id
           AND ws.action_type = 'transport_review'
          ORDER BY ws.step_order
          LIMIT 1
        ),
        workflow_retire AS (
          UPDATE workflow_instances wi
          SET status = 'cancelled',
              current_assigned_user_id = NULL,
              current_assignment_meta = '{}'::jsonb,
              updated_at = ${now}
          FROM workflow_context wc
          WHERE wi.id = wc.previous_instance_id
            AND wi.status = 'active'
          RETURNING wi.id
        ),
        workflow_continuation AS (
          INSERT INTO workflow_instances (
            request_id,
            definition_id,
            definition_version,
            current_step_order,
            status,
            current_assigned_user_id,
            current_assignment_meta,
            routing_context,
            created_at,
            updated_at
          )
          SELECT
            trs.request_id,
            trs.definition_id,
            trs.definition_version,
            trs.step_order,
            'active',
            NULL,
            '{}'::jsonb,
            trs.routing_context,
            ${now},
            ${now}
          FROM transport_review_step trs
          WHERE trs.previous_status <> 'active'
             OR EXISTS (
               SELECT 1
               FROM workflow_retire wr
               WHERE wr.id = trs.previous_instance_id
             )
          RETURNING id, request_id
        ),
        request_reset AS (
          UPDATE transport_requests tr
          SET status = 'transport_review',
              workflow_instance_id = COALESCE(
                (SELECT wc.id FROM workflow_continuation wc WHERE wc.request_id = tr.id LIMIT 1),
                tr.workflow_instance_id
              ),
              assigned_driver_employee_id = NULL,
              assigned_driver_external_party_id = NULL,
              version = version + 1,
              updated_at = ${now}
          FROM allocation_claim ac
          WHERE tr.id = ac.request_id
            AND tr.tenant_id = ${session.tenantId}::uuid
            AND tr.status IN (
              'approved', 'under_review', 'transport_review', 'release_pending',
              'vehicle_allocated', 'authorised'
            )
            AND (
              tr.workflow_instance_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM workflow_continuation wc
                WHERE wc.request_id = tr.id
              )
            )
          RETURNING tr.id, tr.workflow_instance_id
        ),
        drivers_reset AS (
          UPDATE request_drivers rd
          SET is_confirmed = false
          FROM request_reset rr
          WHERE rd.request_id = rr.id
          RETURNING rd.id
        ),
        trip_cancel AS (
          UPDATE trips t
          SET status = 'cancelled', updated_at = ${now}
          FROM request_reset rr
          WHERE t.allocation_id = ${id}::uuid
            AND t.tenant_id = ${session.tenantId}::uuid
            AND t.request_id = rr.id
            AND t.status = 'pending'
            AND t.issued_at IS NULL
          RETURNING t.id
        ),
        authority_cancel AS (
          UPDATE trip_authorities ta
          SET status = 'cancelled',
              cancelled_at = ${now},
              cancellation_reason = ${cancellationReason},
              updated_at = ${now}
          FROM request_reset rr
          WHERE ta.allocation_id = ${id}::uuid
            AND ta.tenant_id = ${session.tenantId}::uuid
            AND ta.request_id = rr.id
            AND ta.status NOT IN ('in_progress', 'awaiting_reconciliation', 'completed', 'closed')
          RETURNING ta.id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, summary, reason, before, after, source_channel
          )
          SELECT
            ${session.tenantId}::uuid,
            ${Date.now()},
            'allocation_cancelled',
            ${session.user.id},
            'cancel',
            'allocation',
            ${id}::uuid,
            ${`Allocation cancelled; request ${allocation.requestReference} returned to Transport Review`},
            ${cancellationReason},
            jsonb_build_object(
              'state', ${allocation.state},
              'driverEmployeeId', ${allocation.driverEmployeeId},
              'workflowInstanceId', (SELECT previous_instance_id FROM workflow_context LIMIT 1)
            ),
            jsonb_build_object(
              'state', 'cancelled',
              'requestStatus', 'transport_review',
              'driverEmployeeId', NULL,
              'workflowInstanceId', (SELECT workflow_instance_id FROM request_reset LIMIT 1)
            ),
            'web'
          FROM request_reset
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM allocation_claim) = 1
           AND (SELECT count(*) FROM request_reset) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'atomic_allocation_cancel_failed_'
            || (SELECT count(*) FROM allocation_claim)::text
            || (SELECT count(*) FROM request_reset)::text
            || (SELECT count(*) FROM audit_insert)::text
        END AS integer) AS committed
      `);
    } catch (mutationError) {
      if (String(mutationError).includes('atomic_allocation_cancel_failed')) {
        return NextResponse.json(
          {
            error: 'The allocation, request, or workflow changed while cancellation was being saved. Refresh and review the latest state.',
          },
          { status: 409 },
        );
      }
      throw mutationError;
    }

    try {
      if (allocation.requesterUserId) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [allocation.requesterUserId],
          category: 'awareness',
          eventType: 'allocation.cancelled',
          title: 'Vehicle allocation cancelled',
          body: `The vehicle allocation for request ${allocation.requestReference} was cancelled and returned to Transport Review. Reason: ${cancellationReason}`,
          entityType: 'allocation',
          entityId: id,
          actionUrl: `/dashboard/requests/${allocation.requestId}`,
          workspace: 'personal',
        });
      }

      if (allocation.driverEmployeeId) {
        const [driver] = await db
          .select({ userId: employees.userId })
          .from(employees)
          .where(and(
            eq(employees.id, allocation.driverEmployeeId),
            eq(employees.tenantId, session.tenantId),
          ))
          .limit(1);
        if (driver?.userId) {
          await createScopedNotifications({
            tenantId: session.tenantId,
            recipientUserIds: [driver.userId],
            category: 'awareness',
            eventType: 'driver.assignment_cancelled',
            title: 'Driver assignment cancelled',
            body: `Your assignment to request ${allocation.requestReference} was cancelled. Reason: ${cancellationReason}`,
            entityType: 'allocation',
            entityId: id,
            actionUrl: '/dashboard/trips',
            workspace: 'driver',
          });
        }
      }

      await recordTenantRequestActivity({
        tenantId: session.tenantId,
        requestId: allocation.requestId,
        reference: allocation.requestReference,
        stage: 'transport_review',
        officeLabel: 'Transport office',
      });
    } catch (postCommitError) {
      console.warn('[Allocation Action] Post-commit cancellation notification/activity failed:', postCommitError);
    }

    return NextResponse.json({ success: true, state: 'cancelled', requestStatus: 'transport_review' });
  } catch (error) {
    if (error instanceof VehicleReplaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Allocation Action] POST failed:', error);
    return NextResponse.json({ error: 'Failed to process allocation action' }, { status: 500 });
  }
}
