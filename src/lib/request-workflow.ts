import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
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

/**
 * Guarantee that standard tenants have a real workflow definition before the
 * engine initialises a request. This keeps new/legacy tenants on the same
 * five-stage workflows as the production seed and prevents the engine's
 * historical ad-hoc fallback from becoming an accidental second business
 * process.
 */
async function ensureDefaultWorkflowDefinition(
  tenantId: string,
  scope: 'regional' | 'national',
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.tenantId, tenantId),
      eq(workflowDefinitions.tripScope, scope),
      eq(workflowDefinitions.isActive, true),
    ))
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
}
