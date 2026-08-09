import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests, workflowInstances } from '@/db/schema';
import { WorkflowEngine, type EngineResult } from '@/lib/workflow-engine';
import { runAtomicMutations } from '@/lib/db-atomic';

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
    .select({ id: transportRequests.id, workflowInstanceId: transportRequests.workflowInstanceId })
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
