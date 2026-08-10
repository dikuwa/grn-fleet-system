import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import type { AuthSession } from '@/lib/auth-helpers';
import { forbiddenResponse, requirePermission } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import {
  WorkflowEngine,
  type EngineResult,
  type WorkflowActionResult,
} from '@/lib/workflow-engine';
import { workflowStepToStatus } from '@/lib/request-status';
import { provisionTripAuthority } from '@/lib/trip-authority';
import { createScopedNotifications, resolveActionNotifications } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { WorkspaceIds } from '@/lib/workspaces';

async function reloadInstance(instanceId: string) {
  const db = getDb();
  return db
    .select()
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/**
 * Recoverable final-authorisation path.
 *
 * The authoriser action is the durable decision marker. Authority provisioning
 * is itself atomic and idempotent. Workflow/request advancement happens only
 * after a complete authority exists. If a transient failure occurs between
 * phases, the same authoriser can retry and resume instead of being blocked by
 * the already-recorded action.
 */
export async function processAuthorisationDecision(input: {
  instanceId: string;
  result: WorkflowActionResult;
  comment?: string;
  session: AuthSession;
}): Promise<EngineResult> {
  const { instanceId, result, comment, session } = input;
  if (!['authorised', 'rejected', 'returned'].includes(result)) {
    return { ok: false, error: NextResponse.json({ error: 'Invalid final-authorisation decision.' }, { status: 400 }) };
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
  if (instance.status !== 'active' || currentStep.actionType !== 'authorise') {
    return { ok: false, error: NextResponse.json({ error: 'This request is no longer awaiting final authorisation.' }, { status: 409 }) };
  }
  if (currentStep.requiresComment && !comment?.trim()) {
    return { ok: false, error: NextResponse.json({ error: 'A comment is required for final authorisation.' }, { status: 400 }) };
  }
  if (currentStep.requiredPermission) {
    const permission = await requirePermission(session, currentStep.requiredPermission as PermissionCode);
    if (permission instanceof NextResponse) return { ok: false, error: permission };
  }
  if (currentStep.assignedUserId && currentStep.assignedUserId !== session.user.id) {
    return { ok: false, error: forbiddenResponse('This final-authorisation step is assigned to another responsible user.') };
  }

  const [requestRecord, actorEmployee] = await Promise.all([
    db
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
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  if (!requestRecord) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow request not found.' }, { status: 404 }) };
  }

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
        'You cannot give final authorisation to a request you created or a trip on which you are the traveller. Another eligible authoriser must act.',
      ),
    };
  }

  const [releaseAction] = await db
    .select({ actorUserId: workflowActions.actorUserId })
    .from(workflowActions)
    .where(and(eq(workflowActions.instanceId, instanceId), eq(workflowActions.actionType, 'release')))
    .limit(1);
  if (releaseAction?.actorUserId === session.user.id) {
    return { ok: false, error: forbiddenResponse('The officer who released this trip cannot also give final authorisation.') };
  }

  // Reject/return have no authority side effect, so commit them in one DB statement.
  if (result === 'rejected' || result === 'returned') {
    const actionId = randomUUID();
    const auditId = randomUUID();
    const nextRequestStatus = result === 'rejected' ? 'rejected' : 'returned';
    const commit = await db.execute(sql`
      WITH claimed AS (
        UPDATE workflow_instances wi
        SET status = 'cancelled', updated_at = now()
        WHERE wi.id = ${instanceId}::uuid
          AND wi.status = 'active'
          AND wi.current_step_order = ${currentStep.stepOrder}
          AND NOT EXISTS (
            SELECT 1 FROM workflow_actions wa
            WHERE wa.instance_id = wi.id AND wa.step_order = ${currentStep.stepOrder}
          )
        RETURNING wi.id, wi.request_id
      ),
      request_updated AS (
        UPDATE transport_requests tr
        SET status = ${nextRequestStatus}, updated_at = now()
        FROM claimed c
        WHERE tr.id = c.request_id
          AND tr.tenant_id = ${session.tenantId}::uuid
          AND tr.status = ${requestRecord.status}
        RETURNING tr.id
      ),
      action_inserted AS (
        INSERT INTO workflow_actions (
          id, instance_id, step_order, action_type, result,
          actor_user_id, actor_employee_id, comment, created_at
        )
        SELECT
          ${actionId}::uuid, c.id, ${currentStep.stepOrder}, 'authorise', ${result},
          ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${comment?.trim() || null}, now()
        FROM claimed c
        INNER JOIN request_updated ru ON ru.id = c.request_id
        RETURNING id
      ),
      audit_inserted AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          actor_employee_id, action, entity_type, entity_id,
          source_channel, summary, reason, created_at
        )
        SELECT
          ${auditId}::uuid, ${session.tenantId}::uuid, ${Date.now()}, ${`workflow_${result}`},
          ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${`workflow.${result}`},
          'workflow_action', ${instanceId}::uuid, 'web',
          ${`Final authorisation: ${result}`}, ${comment?.trim() || null}, now()
        FROM action_inserted
        RETURNING id
      )
      SELECT CAST(
        CASE WHEN (SELECT count(*) FROM audit_inserted) = 1
        THEN '1' ELSE 'atomic_workflow_transition_failed' END AS integer
      ) AS committed
    `);
    const committed = Number((commit.rows?.[0] as { committed?: number | string } | undefined)?.committed ?? 0);
    if (committed !== 1) {
      return {
        ok: false,
        error: NextResponse.json({ error: 'This authorisation changed while you were deciding it. Refresh before trying again.' }, { status: 409 }),
      };
    }

    await resolveActionNotifications({
      tenantId: session.tenantId,
      entityType: 'workflow_instance',
      entityId: instanceId,
      eventTypes: ['approval_assigned', 'approval_conflict_reassigned'],
    }).catch(() => undefined);
    if (requestRecord.requesterUserId) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [requestRecord.requesterUserId],
        category: result === 'returned' ? 'action_required' : 'outcome',
        eventType: `request_${result}`,
        title: result === 'returned' ? 'Request returned for correction' : 'Request rejected',
        body: comment?.trim() || `Your request was ${result}.`,
        entityType: 'workflow_instance',
        entityId: instanceId,
        actionUrl: `/dashboard/requests/${instance.requestId}`,
        workspace: WorkspaceIds.PERSONAL,
        workflowStage: String(currentStep.stepOrder),
        priority: 'high',
      }).catch(() => undefined);
    }
    const updated = await reloadInstance(instanceId);
    if (!updated) {
      return { ok: false, error: NextResponse.json({ error: 'Workflow could not be reloaded after the decision.' }, { status: 500 }) };
    }
    return { ok: true, message: `Request has been ${result}.`, instance: updated };
  }

  const nextStep = status.definition.steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
  if (!nextStep || nextStep.actionType !== 'acknowledge') {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Final authorisation is not followed by a valid driver-acknowledgement stage.' }, { status: 409 }),
    };
  }

  // Final authorisation must be tied to the current operational assignment.
  // Reallocations preserve historical allocation rows, so an unordered request
  // lookup could provision the authority against a cancelled/stale vehicle or
  // driver. Only a confirmed allocation is eligible; if defensive duplicate
  // confirmed rows exist, prefer the most recently updated assignment.
  const [allocationContext] = await db
    .select({
      allocationId: vehicleAllocations.id,
      tripId: trips.id,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      driverUserId: employees.userId,
    })
    .from(vehicleAllocations)
    .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
    .where(
      and(
        eq(vehicleAllocations.requestId, instance.requestId),
        eq(vehicleAllocations.state, 'confirmed'),
        eq(trips.tenantId, session.tenantId),
      ),
    )
    .orderBy(desc(vehicleAllocations.updatedAt), desc(vehicleAllocations.createdAt))
    .limit(1);
  if (!allocationContext?.driverEmployeeId || !allocationContext.driverUserId) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'A current confirmed vehicle allocation and linked eligible driver are required before final authorisation.' }, { status: 409 }),
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
  const roleAssignmentId = typeof resolution.delegationId === 'string' ? resolution.delegationId : null;
  const isActing = resolution.isActing === true;
  const signatureRef = signatureProfile?.confirmedAt
    ? signatureProfile.type === 'typed'
      ? `typed:${signatureProfile.typedName || session.user.name || 'Authorised'}`
      : signatureProfile.ref
    : null;

  const [existingAction] = await db
    .select({ id: workflowActions.id, actorUserId: workflowActions.actorUserId, result: workflowActions.result })
    .from(workflowActions)
    .where(and(eq(workflowActions.instanceId, instanceId), eq(workflowActions.stepOrder, currentStep.stepOrder)))
    .limit(1);
  if (existingAction && (existingAction.result !== 'authorised' || existingAction.actorUserId !== session.user.id)) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'This final-authorisation decision is already owned by another recorded outcome. Refresh the workflow.' }, { status: 409 }),
    };
  }

  if (!existingAction) {
    try {
      await db.insert(workflowActions).values({
        instanceId,
        stepOrder: currentStep.stepOrder,
        actionType: 'authorise',
        result: 'authorised',
        actorUserId: session.user.id,
        actorEmployeeId: actorEmployee?.id || null,
        roleAssignmentId,
        isActing,
        comment: comment?.trim() || null,
        signatureRef,
        metadata: {
          resolvedCapacity: resolution.resolvedCapacity,
          resolvedRoleId: resolution.resolvedRoleId,
          resolvedEmployeeId: resolution.resolvedEmployeeId,
          isActing,
          recoveryPhase: 'decision_recorded',
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      const [racedAction] = await db
        .select({ actorUserId: workflowActions.actorUserId, result: workflowActions.result })
        .from(workflowActions)
        .where(and(eq(workflowActions.instanceId, instanceId), eq(workflowActions.stepOrder, currentStep.stepOrder)))
        .limit(1);
      if (racedAction?.actorUserId !== session.user.id || racedAction.result !== 'authorised') {
        return { ok: false, error: NextResponse.json({ error: 'Another authoriser completed this decision first.' }, { status: 409 }) };
      }
    }
  }

  await provisionTripAuthority({
    tripId: allocationContext.tripId,
    tenantId: session.tenantId,
    requestId: instance.requestId,
    allocationId: allocationContext.allocationId,
    actorUserId: session.user.id,
  });

  const requestStatus = workflowStepToStatus(
    nextStep.stepOrder,
    nextStep.actionType,
    requestRecord.scope as 'regional' | 'national',
  );
  const auditId = randomUUID();
  const commit = await db.execute(sql`
    WITH claimed AS (
      UPDATE workflow_instances wi
      SET current_step_order = ${nextStep.stepOrder}, updated_at = now()
      WHERE wi.id = ${instanceId}::uuid
        AND wi.status = 'active'
        AND wi.current_step_order = ${currentStep.stepOrder}
        AND EXISTS (
          SELECT 1 FROM workflow_actions wa
          WHERE wa.instance_id = wi.id
            AND wa.step_order = ${currentStep.stepOrder}
            AND wa.action_type = 'authorise'
            AND wa.result = 'authorised'
            AND wa.actor_user_id = ${session.user.id}
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
    audit_inserted AS (
      INSERT INTO audit_events (
        id, tenant_id, tenant_sequence, event_type, actor_user_id,
        actor_employee_id, role_assignment_id, is_acting, action,
        entity_type, entity_id, source_channel, summary, reason, created_at
      )
      SELECT
        ${auditId}::uuid, ${session.tenantId}::uuid, ${Date.now()}, 'workflow_authorised',
        ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${roleAssignmentId}::uuid,
        ${isActing}, 'workflow.authorised', 'workflow_action', ${instanceId}::uuid, 'web',
        'Final trip authorisation completed', ${comment?.trim() || null}, now()
      FROM claimed c
      INNER JOIN request_updated ru ON ru.id = c.request_id
      RETURNING id
    )
    SELECT CAST(
      CASE WHEN (SELECT count(*) FROM audit_inserted) = 1
      THEN '1' ELSE 'atomic_workflow_transition_failed' END AS integer
    ) AS committed
  `);
  const committed = Number((commit.rows?.[0] as { committed?: number | string } | undefined)?.committed ?? 0);
  if (committed !== 1) {
    const latest = await reloadInstance(instanceId);
    if (latest?.status === 'active' && latest.currentStepOrder === nextStep.stepOrder) {
      return { ok: true, message: `${currentStep.label} was already committed. Moved to: ${nextStep.label}.`, instance: latest };
    }
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'Final authorisation is recorded but workflow finalisation did not complete. Retry this action to resume safely.' },
        { status: 409 },
      ),
    };
  }

  await resolveActionNotifications({
    tenantId: session.tenantId,
    entityType: 'workflow_instance',
    entityId: instanceId,
    eventTypes: ['approval_assigned', 'approval_conflict_reassigned'],
  }).catch(() => undefined);
  await recordTenantRequestActivity({
    tenantId: session.tenantId,
    requestId: instance.requestId,
    reference: requestRecord.reference,
    stage: 'authorised',
    officeLabel: currentStep.label,
  }).catch(() => undefined);

  if (requestRecord.requesterUserId) {
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: [requestRecord.requesterUserId],
      category: 'outcome',
      eventType: 'request_authorised',
      title: 'Trip authorised',
      body: `Transport request ${requestRecord.reference} has received final authorisation and is awaiting driver acknowledgement.`,
      entityType: 'workflow_instance',
      entityId: instanceId,
      actionUrl: `/dashboard/requests/${instance.requestId}`,
      workspace: WorkspaceIds.PERSONAL,
      workflowStage: String(currentStep.stepOrder),
      priority: 'normal',
    }).catch(() => undefined);
  }
  await createScopedNotifications({
    tenantId: session.tenantId,
    recipientUserIds: [allocationContext.driverUserId],
    category: 'action_required',
    eventType: 'driver_acknowledgement_required',
    title: 'Trip ready for your acknowledgement',
    body: `Transport request ${requestRecord.reference} has been authorised. Review the trip and acknowledge your assignment.`,
    entityType: 'workflow_instance',
    entityId: instanceId,
    actionUrl: `/dashboard/approvals/${instanceId}`,
    workspace: WorkspaceIds.DRIVER,
    workflowStage: String(nextStep.stepOrder),
    priority: 'high',
  }).catch(() => undefined);

  void (async () => {
    try {
      const { scheduleStepReminder, scheduleStepEscalation } = await import('@/lib/inngest/client');
      await Promise.all([
        scheduleStepReminder(instanceId, nextStep.stepOrder, nextStep.reminderAfterHours ?? 1),
        scheduleStepEscalation(instanceId, nextStep.stepOrder, nextStep.escalationAfterHours ?? 2),
      ]);
    } catch {
      // Background jobs are optional.
    }
  })();

  const updated = await reloadInstance(instanceId);
  if (!updated) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow could not be reloaded after final authorisation.' }, { status: 500 }) };
  }
  return {
    ok: true,
    message: `${currentStep.label} completed. Moved to: ${nextStep.label}.`,
    instance: updated,
  };
}
