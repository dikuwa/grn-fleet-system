import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  transportRequests,
  workflowDefinitions,
  workflowInstances,
  workflowSteps,
} from '@/db/schema';
import { Permissions } from '@/lib/permissions';
import { WorkflowEngine, type EngineResult } from '@/lib/workflow-engine';
import { runAtomicMutations } from '@/lib/db-atomic';
import { resolveActionNotifications } from '@/lib/notification-service';

const RESUBMITTABLE_STATUSES = ['returned', 'rejected', 'supervisor_rejected'] as const;

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === 'string') return record.code;
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return null;
}

function databaseErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || '');
  const record = error as {
    message?: unknown;
    detail?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };
  const parts = [record.message, record.detail, record.constraint]
    .filter((value): value is string => typeof value === 'string');
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as {
      message?: unknown;
      detail?: unknown;
      constraint?: unknown;
    };
    parts.push(
      ...[cause.message, cause.detail, cause.constraint]
        .filter((value): value is string => typeof value === 'string'),
    );
  }
  return parts.join(' ');
}

function isConcurrentFallbackPublish(error: unknown) {
  return (
    databaseErrorCode(error) === '23505' &&
    databaseErrorText(error).includes('workflow_definitions_one_active_per_route')
  );
}

/**
 * A request returned after Transport Review may already have a provisional or
 * confirmed vehicle/driver allocation. A corrected resubmission must never
 * carry that operational snapshot into a fresh approval workflow because the
 * changed schedule, route, passengers or nominated driver may invalidate it.
 *
 * This boundary runs only for returned/rejected requests whose previous
 * workflow link has already been cleared by the resubmit transaction. It
 * retires pre-operations state atomically and refuses to proceed if a trip was
 * physically issued or otherwise entered operations.
 */
async function retirePreOperationsStateForResubmission(input: {
  requestId: string;
  tenantId: string;
  status: string;
}) {
  if (!RESUBMITTABLE_STATUSES.includes(input.status as (typeof RESUBMITTABLE_STATUSES)[number])) {
    return;
  }

  const db = getDb();
  const now = new Date();
  const cancellationReason = 'Request corrected and resubmitted; prior operational allocation retired.';

  try {
    await db.execute(sql`
      WITH request_guard AS (
        SELECT tr.id
        FROM transport_requests tr
        WHERE tr.id = ${input.requestId}::uuid
          AND tr.tenant_id = ${input.tenantId}::uuid
          AND tr.status = ${input.status}
          AND tr.workflow_instance_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.request_id = tr.id
              AND t.tenant_id = ${input.tenantId}::uuid
              AND (t.issued_at IS NOT NULL OR t.status <> 'pending')
          )
      ),
      allocation_cancel AS (
        UPDATE vehicle_allocations va
        SET state = 'cancelled',
            override_reason = ${cancellationReason},
            version = va.version + 1,
            updated_at = ${now}
        WHERE va.request_id = ${input.requestId}::uuid
          AND va.state IN ('provisional', 'confirmed')
          AND EXISTS (SELECT 1 FROM request_guard)
        RETURNING va.id
      ),
      external_assignment_cancel AS (
        UPDATE external_driver_assignments eda
        SET state = 'cancelled',
            cancelled_at = ${now},
            cancellation_reason = ${cancellationReason},
            updated_at = ${now}
        WHERE eda.tenant_id = ${input.tenantId}::uuid
          AND eda.request_id = ${input.requestId}::uuid
          AND eda.state IN ('pending_acceptance', 'accepted')
          AND EXISTS (SELECT 1 FROM request_guard)
        RETURNING eda.id
      ),
      pending_trip_cancel AS (
        UPDATE trips t
        SET status = 'cancelled', updated_at = ${now}
        WHERE t.request_id = ${input.requestId}::uuid
          AND t.tenant_id = ${input.tenantId}::uuid
          AND t.status = 'pending'
          AND t.issued_at IS NULL
          AND EXISTS (SELECT 1 FROM request_guard)
        RETURNING t.id
      ),
      authority_cancel AS (
        UPDATE trip_authorities ta
        SET status = 'cancelled',
            cancelled_at = ${now},
            cancellation_reason = ${cancellationReason},
            updated_at = ${now}
        WHERE ta.request_id = ${input.requestId}::uuid
          AND ta.tenant_id = ${input.tenantId}::uuid
          AND ta.status NOT IN ('in_progress', 'awaiting_reconciliation', 'completed', 'closed', 'cancelled')
          AND EXISTS (SELECT 1 FROM request_guard)
        RETURNING ta.id
      ),
      request_reset AS (
        UPDATE transport_requests tr
        SET assigned_driver_employee_id = NULL,
            assigned_driver_external_party_id = NULL,
            updated_at = ${now}
        WHERE tr.id = ${input.requestId}::uuid
          AND tr.tenant_id = ${input.tenantId}::uuid
          AND EXISTS (SELECT 1 FROM request_guard)
        RETURNING tr.id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM request_guard) = 1
         AND (SELECT count(*) FROM request_reset) = 1
        THEN '1'
        ELSE 'atomic_resubmit_operational_state_failed'
      END AS integer) AS committed
    `);
  } catch (error) {
    if (String(error).includes('atomic_resubmit_operational_state_failed')) {
      throw new Error(
        'This request changed or entered trip operations before resubmission could restart its workflow.',
      );
    }
    throw error;
  }
}

/**
 * Guarantee that standard tenants have a real fallback workflow definition
 * before the engine initialises a request. A route only counts as the fallback
 * when every routing dimension is a wildcard. Geography-, origin-, finance-
 * or category-specific routes cannot safely serve unrelated requests. This
 * prevents a tenant with only specialised routes from leaving other submissions
 * or corrected/resubmitted requests without an approval path.
 */
async function ensureDefaultWorkflowDefinition(
  tenantId: string,
  scope: 'regional' | 'national',
): Promise<void> {
  const db = getDb();
  const fallbackConditions = and(
    eq(workflowDefinitions.tenantId, tenantId),
    eq(workflowDefinitions.tripScope, scope),
    eq(workflowDefinitions.isActive, true),
    isNull(workflowDefinitions.regionId),
    isNull(workflowDefinitions.officeId),
    isNull(workflowDefinitions.departmentId),
    isNull(workflowDefinitions.requestOrigin),
    isNull(workflowDefinitions.financialImpact),
    isNull(workflowDefinitions.tripCategory),
  );
  const [existing] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(fallbackConditions)
    .limit(1);
  if (existing) return;

  const definitionId = randomUUID();
  const name = scope === 'regional' ? 'Regional Trip Workflow' : 'National Trip Workflow';
  const common = [
    {
      definitionId,
      stepOrder: 1,
      actionType: 'supervisor_approve',
      requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR,
      label: 'Supervisor Approval',
      description: 'Immediate supervisor reviews and approves the transport request.',
      allowsEmergencyOverride: false,
      separationDutyRole: 'requester',
    },
    {
      definitionId,
      stepOrder: 2,
      actionType: 'transport_review',
      requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT,
      label: 'Transport Review',
      description: 'Transport Administration reviews feasibility and completes operational allocation details.',
      allowsEmergencyOverride: false,
      separationDutyRole: 'requester',
    },
  ];
  const scoped = scope === 'regional'
    ? [
        {
          definitionId,
          stepOrder: 3,
          actionType: 'release',
          requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL,
          label: 'Administrative Release',
          description: 'Control Administrative Officer releases the regional trip for final authorisation.',
          allowsEmergencyOverride: true,
          separationDutyRole: 'requester',
        },
        {
          definitionId,
          stepOrder: 4,
          actionType: 'authorise',
          requiredPermission: Permissions.TRIP_AUTHORIZE_REGIONAL,
          label: 'Final Authorisation',
          description: 'Deputy Director gives final regional trip authorisation.',
          allowsEmergencyOverride: true,
          separationDutyRole: 'release',
        },
      ]
    : [
        {
          definitionId,
          stepOrder: 3,
          actionType: 'release',
          requiredPermission: Permissions.VEHICLE_RELEASE_NATIONAL,
          label: 'Director Release',
          description: 'Director releases the national trip for final authorisation.',
          allowsEmergencyOverride: true,
          separationDutyRole: 'requester',
        },
        {
          definitionId,
          stepOrder: 4,
          actionType: 'authorise',
          requiredPermission: Permissions.TRIP_AUTHORIZE_NATIONAL,
          label: 'CRO Authorisation',
          description: 'Chief Regional Officer gives final national trip authorisation.',
          requiresComment: true,
          allowsEmergencyOverride: true,
          separationDutyRole: 'release',
        },
      ];
  const driverStep = {
    definitionId,
    stepOrder: 5,
    actionType: 'acknowledge',
    requiredPermission: Permissions.DRIVER_LOG_CREATE,
    label: 'Driver Acknowledgement',
    description: 'Assigned driver acknowledges the approved trip and vehicle assignment.',
    allowsEmergencyOverride: false,
  };

  try {
    await runAtomicMutations((tx) => [
      tx.insert(workflowDefinitions).values({
        id: definitionId,
        tenantId,
        tripScope: scope,
        version: 1,
        name,
        isActive: true,
      }),
      tx.insert(workflowSteps).values([...common, ...scoped, driverStep]),
    ]);
  } catch (error) {
    // Migration 0094 guarantees one active exact route across all routing
    // dimensions. Two first-time submissions can still race between the read
    // above and the insert; if the other request successfully created the true
    // all-wildcard fallback, recover instead of failing an otherwise valid
    // submission/resubmission.
    if (!isConcurrentFallbackPublish(error)) throw error;
    const [concurrentFallback] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(fallbackConditions)
      .limit(1);
    if (!concurrentFallback) throw error;
  }
}

/**
 * Initialise or recover the active workflow for a request.
 *
 * WorkflowEngine performs persistence before best-effort notifications/audit.
 * If an external side effect throws after the instance was persisted, callers
 * must not report a failed submission while a valid active workflow already
 * exists. This helper recovers that persisted instance and repairs the request
 * link instead of creating a duplicate workflow.
 */
export async function ensureRequestWorkflow(
  requestId: string,
  tenantId: string,
): Promise<EngineResult> {
  const db = getDb();

  const [request] = await db
    .select({
      id: transportRequests.id,
      scope: transportRequests.scope,
      status: transportRequests.status,
      workflowInstanceId: transportRequests.workflowInstanceId,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
    .limit(1);

  if (!request) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Transport request not found' }, { status: 404 }),
    };
  }

  if (request.workflowInstanceId) {
    const [linked] = await db
      .select()
      .from(workflowInstances)
      .where(
        and(
          eq(workflowInstances.id, request.workflowInstanceId),
          eq(workflowInstances.requestId, requestId),
          eq(workflowInstances.status, 'active'),
        ),
      )
      .limit(1);
    if (linked) {
      return { ok: true, message: 'Existing active workflow recovered.', instance: linked };
    }
  }

  const recoverPersistedInstance = async (): Promise<EngineResult | null> => {
    const [active] = await db
      .select()
      .from(workflowInstances)
      .where(and(eq(workflowInstances.requestId, requestId), eq(workflowInstances.status, 'active')))
      .orderBy(desc(workflowInstances.createdAt))
      .limit(1);
    if (!active) return null;

    await db
      .update(transportRequests)
      .set({ workflowInstanceId: active.id, updatedAt: new Date() })
      .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)));

    return { ok: true, message: 'Persisted workflow recovered.', instance: active };
  };

  const recoveredBeforeInit = await recoverPersistedInstance();
  if (recoveredBeforeInit) return recoveredBeforeInit;

  await retirePreOperationsStateForResubmission({
    requestId,
    tenantId,
    status: request.status,
  });

  const scope: 'regional' | 'national' = request.scope === 'national' ? 'national' : 'regional';
  await ensureDefaultWorkflowDefinition(tenantId, scope);

  const engine = new WorkflowEngine({ db });
  try {
    const result = await engine.initializeForRequest(requestId, tenantId);
    if (result.ok) return result;

    // A returned EngineResult should normally mean no persistence happened,
    // but recover defensively in case the implementation changes.
    return (await recoverPersistedInstance()) ?? result;
  } catch (error) {
    const recovered = await recoverPersistedInstance();
    if (recovered) {
      console.warn('[request-workflow] Recovered workflow after post-persist initialisation error:', error);
      return recovered;
    }
    throw error;
  }
}

/**
 * Compensating rollback used when a request cannot be finalised after a new
 * workflow instance was created. The corrected request data remains available
 * to the requester, but the unusable active workflow is cancelled and unlinked.
 */
export async function abandonRequestWorkflow(
  requestId: string,
  tenantId: string,
  instanceId: string,
): Promise<void> {
  const now = new Date();
  await runAtomicMutations((tx) => [
    tx.update(workflowInstances)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(workflowInstances.id, instanceId), eq(workflowInstances.requestId, requestId))),
    tx.update(transportRequests)
      .set({ workflowInstanceId: null, updatedAt: now })
      .where(and(
        eq(transportRequests.id, requestId),
        eq(transportRequests.tenantId, tenantId),
        eq(transportRequests.workflowInstanceId, instanceId),
      )),
  ]);

  await resolveActionNotifications({
    tenantId,
    entityType: 'workflow_instance',
    entityId: instanceId,
  }).catch((notificationError) => {
    console.warn('[request-workflow] Could not resolve abandoned workflow notifications:', notificationError);
  });
}
