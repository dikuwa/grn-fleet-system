import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { workflowInstances } from '@/db/schema/workflows';
import type { AuthSession } from '@/lib/auth-helpers';
import { forbiddenResponse, requirePermission } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { workflowCompletedStatus, workflowStepToStatus } from '@/lib/request-status';
import {
  createScopedNotifications,
  resolveActionNotifications,
} from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';
import {
  WorkflowEngine,
  type EngineResult,
  type WorkflowActionResult,
  type WorkflowActionType,
} from '@/lib/workflow-engine';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

const ATOMIC_ACTIONS = ['transport_review', 'release'] as const;
type AtomicAction = (typeof ATOMIC_ACTIONS)[number];

function expectedPositiveResult(action: AtomicAction): WorkflowActionResult {
  return action === 'release' ? 'released' : 'approved';
}

/**
 * Atomically commits workflow stages whose durable business effect is the
 * decision itself. Transport Review operational edits/allocation are completed
 * before this endpoint; Release advances the approval chain. Neither stage
 * needs a post-decision domain write, so action history, workflow position,
 * request status and audit evidence can be one race-safe SQL statement.
 */
export async function processAtomicWorkflowDecision(input: {
  instanceId: string;
  action: WorkflowActionType;
  result: WorkflowActionResult;
  comment?: string;
  session: AuthSession;
}): Promise<EngineResult> {
  const { instanceId, result, comment, session } = input;
  if (!ATOMIC_ACTIONS.includes(input.action as AtomicAction)) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'This workflow stage is not handled by the atomic decision path.' }, { status: 400 }),
    };
  }
  const action = input.action as AtomicAction;
  const positiveResult = expectedPositiveResult(action);
  if (![positiveResult, 'rejected', 'returned'].includes(result)) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Invalid workflow decision for this stage.' }, { status: 400 }),
    };
  }
  if (['rejected', 'returned'].includes(result) && !comment?.trim()) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: result === 'returned' ? 'A correction reason is required.' : 'A rejection reason is required.' },
        { status: 400 },
      ),
    };
  }

  const db = getDb();
  const engine = new WorkflowEngine({ db });
  const status = await engine.getWorkflowStatus(instanceId);
  if (!status?.currentStep) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow step not found.' }, { status: 404 }) };
  }
  const { instance, currentStep } = status;
  if (instance.status !== 'active' || currentStep.actionType !== action) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'This workflow is no longer awaiting this decision.' }, { status: 409 }),
    };
  }
  if (currentStep.requiresComment && !comment?.trim()) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'A comment is required for this workflow stage.' }, { status: 400 }),
    };
  }
  if (currentStep.requiredPermission) {
    const permission = await requirePermission(session, currentStep.requiredPermission as PermissionCode);
    if (permission instanceof NextResponse) return { ok: false, error: permission };
  }
  if (currentStep.assignedUserId && currentStep.assignedUserId !== session.user.id) {
    return {
      ok: false,
      error: forbiddenResponse('This workflow step is assigned to another responsible user.'),
    };
  }

  const [requestRecord] = await db
    .select({
      id: transportRequests.id,
      tenantId: transportRequests.tenantId,
      requesterUserId: transportRequests.requesterUserId,
      requesterEmployeeId: transportRequests.requesterEmployeeId,
      travellerEmployeeId: transportRequests.travellerEmployeeId,
      reference: transportRequests.reference,
      scope: transportRequests.scope,
      status: transportRequests.status,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, instance.requestId), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);
  if (!requestRecord) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow request not found.' }, { status: 404 }) };
  }

  const [actorEmployee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
    .limit(1);

  const selfConflict =
    requestRecord.requesterUserId === session.user.id ||
    Boolean(
      actorEmployee &&
      (requestRecord.requesterEmployeeId === actorEmployee.id ||
        requestRecord.travellerEmployeeId === actorEmployee.id),
    );
  if (selfConflict) {
    return {
      ok: false,
      error: forbiddenResponse(
        'You cannot review or release a request you created or a trip on which you are the traveller. Another eligible officer must complete this stage.',
      ),
    };
  }

  const [signatureProfile] = await db
    .select({
      type: userProfiles.signatureType,
      ref: userProfiles.signatureRef,
      typedName: userProfiles.signatureTypedName,
      confirmedAt: userProfiles.signatureConfirmedAt,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const resolution = (currentStep.config || {}) as Record<string, unknown>;
  const nextStep = status.definition.steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
  const succeeded = result === positiveResult;
  const requestStatus =
    result === 'rejected'
      ? 'rejected'
      : result === 'returned'
        ? 'returned'
        : nextStep
          ? workflowStepToStatus(
              nextStep.stepOrder,
              nextStep.actionType,
              requestRecord.scope as 'regional' | 'national',
            )
          : workflowCompletedStatus();
  const workflowStatus = succeeded ? (nextStep ? 'active' : 'completed') : 'cancelled';
  const nextOrder = succeeded && nextStep ? nextStep.stepOrder : currentStep.stepOrder;
  const roleAssignmentId = typeof resolution.delegationId === 'string' ? resolution.delegationId : null;
  const isActing = resolution.isActing === true;
  const signatureRef =
    signatureProfile?.confirmedAt && succeeded
      ? signatureProfile.type === 'typed'
        ? `typed:${signatureProfile.typedName || session.user.name || currentStep.label}`
        : signatureProfile.ref
      : null;
  const actionId = randomUUID();
  const auditId = randomUUID();
  const actionMetadata = JSON.stringify({
    resolvedCapacity: resolution.resolvedCapacity,
    resolvedRoleId: resolution.resolvedRoleId,
    resolvedEmployeeId: resolution.resolvedEmployeeId,
    isActing,
  });
  const auditBefore = JSON.stringify({
    workflowStatus: instance.status,
    currentStepOrder: instance.currentStepOrder,
    requestStatus: requestRecord.status,
  });
  const auditAfter = JSON.stringify({
    workflowStatus,
    currentStepOrder: nextOrder,
    requestStatus,
    result,
  });

  try {
    const commit = await db.execute(sql`
      WITH claimed AS (
        UPDATE workflow_instances wi
        SET current_step_order = ${nextOrder}, status = ${workflowStatus}, updated_at = now()
        WHERE wi.id = ${instanceId}::uuid
          AND wi.status = 'active'
          AND wi.current_step_order = ${currentStep.stepOrder}
          AND EXISTS (
            SELECT 1 FROM transport_requests tr
            WHERE tr.id = wi.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = ${requestRecord.status}
          )
          AND NOT EXISTS (
            SELECT 1 FROM workflow_actions wa
            WHERE wa.instance_id = wi.id AND wa.step_order = ${currentStep.stepOrder}
          )
        RETURNING wi.id, wi.request_id
      ),
      request_updated AS (
        UPDATE transport_requests tr
        SET status = ${requestStatus}, updated_at = now()
        FROM claimed c
        WHERE tr.id = c.request_id
          AND tr.tenant_id = ${session.tenantId}::uuid
          AND tr.status = ${requestRecord.status}
        RETURNING tr.id
      ),
      action_inserted AS (
        INSERT INTO workflow_actions (
          id, instance_id, step_order, action_type, result,
          actor_user_id, actor_employee_id, role_assignment_id,
          is_acting, comment, signature_ref, metadata, created_at
        )
        SELECT
          ${actionId}::uuid, c.id, ${currentStep.stepOrder}, ${action}, ${result},
          ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${roleAssignmentId}::uuid,
          ${isActing}, ${comment?.trim() || null}, ${signatureRef}, ${actionMetadata}::jsonb, now()
        FROM claimed c
        INNER JOIN request_updated ru ON ru.id = c.request_id
        RETURNING id
      ),
      audit_inserted AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          actor_employee_id, role_assignment_id, is_acting, action,
          entity_type, entity_id, source_channel, before, after,
          summary, reason, created_at
        )
        SELECT
          ${auditId}::uuid, ${session.tenantId}::uuid, ${Date.now()}, ${`workflow_${result}`},
          ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${roleAssignmentId}::uuid,
          ${isActing}, ${`workflow.${result}`}, 'workflow_action', ${instanceId}::uuid, 'web',
          ${auditBefore}::jsonb, ${auditAfter}::jsonb,
          ${`${currentStep.label}: ${result}`}, ${comment?.trim() || null}, now()
        FROM action_inserted
        RETURNING id
      )
      SELECT CAST(
        CASE
          WHEN (SELECT count(*) FROM claimed) = 1
           AND (SELECT count(*) FROM request_updated) = 1
           AND (SELECT count(*) FROM action_inserted) = 1
           AND (SELECT count(*) FROM audit_inserted) = 1
          THEN '1'
          ELSE 'atomic_workflow_transition_failed'
        END AS integer
      ) AS committed
    `);
    const committed = Number(
      (commit.rows?.[0] as { committed?: number | string } | undefined)?.committed ?? 0,
    );
    if (committed !== 1) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'This workflow changed while you were deciding it. Refresh before trying again.' },
          { status: 409 },
        ),
      };
    }
  } catch (error) {
    console.error('[workflow-decision-atomic] Decision failed:', error);
    const latest = await engine.getWorkflowStatus(instanceId).catch(() => null);
    if (latest?.instance.status !== 'active' || latest?.instance.currentStepOrder !== currentStep.stepOrder) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'This workflow has already moved to another state. Refresh to see the latest decision.' },
          { status: 409 },
        ),
      };
    }
    throw error;
  }

  await resolveActionNotifications({
    tenantId: session.tenantId,
    entityType: 'workflow_instance',
    entityId: instanceId,
    eventTypes: ['approval_assigned', 'approval_conflict_reassigned'],
  }).catch((error) => console.warn('[workflow-decision-atomic] Could not resolve old notification:', error));

  await recordTenantRequestActivity({
    tenantId: session.tenantId,
    requestId: instance.requestId,
    reference: requestRecord.reference,
    stage: result,
    officeLabel: currentStep.label,
  }).catch((error) => console.warn('[workflow-decision-atomic] Activity update failed:', error));

  if (requestRecord.requesterUserId) {
    const outcomeTitle =
      result === 'released'
        ? 'Trip released for final authorisation'
        : result === 'approved'
          ? `${currentStep.label} completed`
          : result === 'returned'
            ? 'Request returned for correction'
            : 'Request rejected';
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: [requestRecord.requesterUserId],
      category: result === 'returned' ? 'action_required' : 'outcome',
      eventType: `request_${result}`,
      title: outcomeTitle,
      body: comment?.trim() || `${currentStep.label} completed with result: ${result}.`,
      entityType: 'workflow_instance',
      entityId: instanceId,
      actionUrl: `/dashboard/requests/${instance.requestId}`,
      workspace: WorkspaceIds.PERSONAL,
      workflowStage: String(currentStep.stepOrder),
      priority: result === 'rejected' ? 'high' : 'normal',
    }).catch((error) => console.warn('[workflow-decision-atomic] Requester notification failed:', error));
  }

  if (succeeded && nextStep) {
    const recipients = await engine
      .getCurrentStepRecipients(instanceId, session.tenantId)
      .catch(() => []);
    const nextRecipients = recipients.filter((userId) => userId !== requestRecord.requesterUserId);
    if (nextRecipients.length) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: nextRecipients,
        category: 'action_required',
        eventType: 'approval_assigned',
        title: `Action Required — ${nextStep.label}`,
        body: `Transport request ${requestRecord.reference} is awaiting your action.`,
        entityType: 'workflow_instance',
        entityId: instanceId,
        actionUrl: `/dashboard/approvals/${instanceId}`,
        workspace: WorkspaceIds.APPROVER,
        workflowStage: String(nextStep.stepOrder),
        priority: 'high',
      }).catch((error) => console.warn('[workflow-decision-atomic] Next-step notification failed:', error));
    }

    void (async () => {
      try {
        const { scheduleStepReminder, scheduleStepEscalation } = await import('@/lib/inngest/client');
        await Promise.all([
          scheduleStepReminder(instanceId, nextStep.stepOrder, nextStep.reminderAfterHours ?? 2),
          scheduleStepEscalation(instanceId, nextStep.stepOrder, nextStep.escalationAfterHours ?? 4),
        ]);
      } catch {
        // Background jobs are optional.
      }
    })();
  }

  const [updatedInstance] = await db
    .select()
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1);
  if (!updatedInstance) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Workflow could not be reloaded after the decision.' }, { status: 500 }),
    };
  }

  return {
    ok: true,
    message:
      succeeded
        ? nextStep
          ? `${currentStep.label} completed. Moved to: ${nextStep.label}.`
          : 'Workflow completed.'
        : `Request has been ${result}.`,
    instance: updatedInstance,
  };
}
