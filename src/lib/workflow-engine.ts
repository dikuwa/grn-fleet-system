/**
 * Workflow Engine
 *
 * State machine that manages transport request approval workflows through
 * defined stages: supervisor_approve → transport_review → release →
 * authorise → acknowledge.
 *
 * Each workflow definition is versioned per tenant and trip scope (regional
 * vs national). The engine validates permissions, separation of duty,
 * handles emergency overrides, and records every action in the audit log.
 *
 * Usage (API route handler):
 *   const engine = new WorkflowEngine({ db, session });
 *   const result = await engine.processAction({
 *     instanceId, action: 'approve', comment: 'Approved.',
 *   });
 */

import { getDb } from '@/db';
import {
  workflowDefinitions,
  workflowSteps,
  workflowInstances,
  workflowActions,
  emergencyOverrides,
  transportRequests,
  auditEvents,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth-helpers';
import { requirePermission, forbiddenResponse } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { Permissions } from '@/lib/permissions';
import { notifications } from '@/db/schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinels for ad-hoc / built-in workflow definitions */
export const ADHOC_DEFINITION_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowActionType =
  | 'supervisor_approve'
  | 'transport_review'
  | 'release'
  | 'authorise'
  | 'acknowledge';

export type WorkflowActionResult = 'approved' | 'rejected' | 'returned' | 'released' | 'authorised' | 'acknowledged' | 'overridden';

export type ProcessActionInput = {
  instanceId: string;
  action: WorkflowActionType;
  result: WorkflowActionResult;
  actorUserId: string;
  comment?: string;
  metadata?: Record<string, unknown>;
};

export type EngineResult =
  | { ok: true; message: string; instance: typeof workflowInstances.$inferSelect }
  | { ok: false; error: NextResponse };

// ---------------------------------------------------------------------------
// Default workflow definitions
// ---------------------------------------------------------------------------

/** Steps for a regional-scope trip */
const REGIONAL_WORKFLOW_STEPS = [
  {
    stepOrder: 1,
    actionType: 'supervisor_approve' as const,
    requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR as PermissionCode,
    label: 'Supervisor Approval',
    description: 'Immediate supervisor reviews and approves the transport request.',
    requiresComment: false,
    reminderAfterHours: 2,
    escalationAfterHours: 4,
    allowsEmergencyOverride: false,
    separationDutyRole: 'requester',
  },
  {
    stepOrder: 2,
    actionType: 'transport_review' as const,
    requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT as PermissionCode,
    label: 'Transport Review',
    description: 'Transport office reviews the request for feasibility and vehicle assignment.',
    requiresComment: false,
    reminderAfterHours: 2,
    escalationAfterHours: 8,
    allowsEmergencyOverride: false,
    separationDutyRole: 'requester',
  },
  {
    stepOrder: 3,
    actionType: 'release' as const,
    requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL as PermissionCode,
    label: 'Vehicle Release',
    description: 'Authorised officer releases the vehicle for the trip.',
    requiresComment: false,
    reminderAfterHours: 1,
    escalationAfterHours: 4,
    allowsEmergencyOverride: true,
    separationDutyRole: null,
  },
  {
    stepOrder: 4,
    actionType: 'authorise' as const,
    requiredPermission: Permissions.TRIP_AUTHORIZE_REGIONAL as PermissionCode,
    label: 'Trip Authorisation',
    description: 'Deputy Director authorises the trip.',
    requiresComment: false,
    reminderAfterHours: 2,
    escalationAfterHours: 8,
    allowsEmergencyOverride: true,
    separationDutyRole: null,
  },
  {
    stepOrder: 5,
    actionType: 'acknowledge' as const,
    requiredPermission: Permissions.DRIVER_LOG_CREATE as PermissionCode,
    label: 'Driver Acknowledgment',
    description: 'Assigned driver acknowledges the trip details and vehicle condition.',
    requiresComment: false,
    reminderAfterHours: 1,
    escalationAfterHours: 2,
    allowsEmergencyOverride: false,
    separationDutyRole: null,
  },
] as const;

/** Steps for a national-scope trip (adds Director step) */
const NATIONAL_WORKFLOW_STEPS = [
  ...REGIONAL_WORKFLOW_STEPS.slice(0, 3),
  {
    stepOrder: 4,
    actionType: 'release' as const,
    requiredPermission: Permissions.VEHICLE_RELEASE_NATIONAL as PermissionCode,
    label: 'National Vehicle Release',
    description: 'Director releases the vehicle for the national trip.',
    requiresComment: false,
    reminderAfterHours: 2,
    escalationAfterHours: 8,
    allowsEmergencyOverride: true,
    separationDutyRole: null,
  },
  {
    stepOrder: 5,
    actionType: 'authorise' as const,
    requiredPermission: Permissions.TRIP_AUTHORIZE_NATIONAL as PermissionCode,
    label: 'National Trip Authorisation',
    description: 'Chief Regional Officer authorises the national trip.',
    requiresComment: true,
    reminderAfterHours: 2,
    escalationAfterHours: 8,
    allowsEmergencyOverride: true,
    separationDutyRole: null,
  },
  {
    stepOrder: 6,
    actionType: 'acknowledge' as const,
    requiredPermission: Permissions.DRIVER_LOG_CREATE as PermissionCode,
    label: 'Driver Acknowledgment',
    description: 'Assigned driver acknowledges the trip.',
    requiresComment: false,
    reminderAfterHours: 1,
    escalationAfterHours: 2,
    allowsEmergencyOverride: false,
    separationDutyRole: null,
  },
] as const;

// ---------------------------------------------------------------------------
// WorkflowEngine class
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private db: ReturnType<typeof getDb>;

  constructor(opts?: { db?: ReturnType<typeof getDb> }) {
    this.db = opts?.db ?? getDb();
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Create a workflow instance for a transport request.
   * Looks up the appropriate definition based on trip scope, or creates
   * an ad-hoc instance if no definition is found.
   */
  async initializeForRequest(requestId: string, tenantId: string): Promise<EngineResult> {
    const [request] = await this.db
      .select({ scope: transportRequests.scope, id: transportRequests.id })
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);

    if (!request) {
      return { ok: false, error: NextResponse.json({ error: 'Transport request not found' }, { status: 404 }) };
    }

    const scope = request.scope || 'regional';

    // Try to find a matching active definition
    const [definition] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, tenantId),
          eq(workflowDefinitions.tripScope, scope),
          eq(workflowDefinitions.isActive, true),
        ),
      )
      .orderBy(workflowDefinitions.version)
      .limit(1);

    // If no definition exists, we use the built-in defaults
    const steps = scope === 'national' ? NATIONAL_WORKFLOW_STEPS : REGIONAL_WORKFLOW_STEPS;

    const [instance] = await this.db
      .insert(workflowInstances)
      .values({
        requestId,
        definitionId: definition?.id ?? ADHOC_DEFINITION_ID,
        definitionVersion: definition?.version ?? 1,
        currentStepOrder: 1,
        status: 'active',
      })
      .returning();

    // Link the workflow instance to the transport request
    await this.db
      .update(transportRequests)
      .set({ workflowInstanceId: instance.id, updatedAt: new Date() })
      .where(eq(transportRequests.id, requestId));

    await this.logAuditEvent({
      entityType: 'workflow_instance',
      entityId: instance.id,
      action: 'workflow.initialized',
      actorUserId: 'system',
      metadata: { requestId, scope, stepCount: steps.length },
    }, tenantId);

    return { ok: true, message: `Workflow initialised for ${scope} trip.`, instance };
  }

  // -------------------------------------------------------------------------
  // Action processing
  // -------------------------------------------------------------------------

  /**
   * Process a workflow action (approve, reject, return, release, authorise,
   * acknowledge, override).
   *
   * Validates:
   *   1. Instance is active
   *   2. Actor has the required permission for the current step
   *   3. Separation of duty (actor is not the requester for approval steps)
   *   4. Comment is provided if required
   *
   * On success, records the action and advances the workflow.
   */
  async processAction(
    input: ProcessActionInput,
    session: AuthSession,
  ): Promise<EngineResult> {
    const { instanceId, action, result, comment } = input;

    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      return { ok: false, error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }) };
    }

    if (instance.status !== 'active') {
      return { ok: false, error: NextResponse.json({ error: `Workflow is already ${instance.status}.` }, { status: 409 }) };
    }

    // Get the current step definition
    const steps = await this.getDefinitionSteps(instance);
    const currentStep = steps.find((s) => s.stepOrder === instance.currentStepOrder);

    if (!currentStep) {
      return { ok: false, error: NextResponse.json({ error: 'No step found at the current position.' }, { status: 400 }) };
    }

    if (currentStep.actionType !== action) {
      return { ok: false, error: NextResponse.json({
        error: `Expected action "${currentStep.actionType}" but received "${action}".`,
      }, { status: 400 }) };
    }

    // Validate: comment required
    if (currentStep.requiresComment && !comment?.trim()) {
      return { ok: false, error: NextResponse.json({ error: 'A comment is required for this action.' }, { status: 400 }) };
    }

    // Validate: permission
    if (currentStep.requiredPermission) {
      const permCheck = await requirePermission(
        session,
        currentStep.requiredPermission as PermissionCode,
      );
      if (permCheck instanceof NextResponse) {
        return { ok: false, error: permCheck };
      }
    }

    // Validate: separation of duty
    if (currentStep.separationDutyRole === 'requester') {
      const [request] = await this.db
        .select({ requesterUserId: transportRequests.requesterUserId })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);

      if (request && request.requesterUserId === session.user.id) {
        return {
          ok: false,
          error: forbiddenResponse('You cannot approve your own request. Another authorised person must review it.'),
        };
      }
    }

    // Record the action
    await this.db.insert(workflowActions).values({
      instanceId: instance.id,
      stepOrder: currentStep.stepOrder,
      actionType: action,
      result,
      actorUserId: session.user.id,
      comment: comment ?? null,
    });

    await this.logAuditEvent({
      entityType: 'workflow_action',
      entityId: instance.id,
      action: `workflow.${result}`,
      actorUserId: session.user.id,
      metadata: { stepOrder: currentStep.stepOrder, actionType: action, comment },
    }, session.tenantId);

    // Fire-and-forget notification + email
    await this.sendActionNotification(instance, currentStep, result, session).catch(() => {
      // Notification is best-effort
    });

    // Handle rejection or return — the workflow stops and the request
    // is returned to the requester for revision.
    if (result === 'rejected' || result === 'returned') {
      const newStatus = result === 'rejected' ? 'rejected' : 'returned';
      await this.db
        .update(workflowInstances)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(workflowInstances.id, instance.id));
      await this.db
        .update(transportRequests)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(transportRequests.id, instance.requestId));
      const [updatedInstance] = await this.db
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instance.id))
        .limit(1);
      return {
        ok: true,
        message: `Request has been ${result}.`,
        instance: updatedInstance,
      };
    }

    // Advance to the next step
    const nextStepOrder = currentStep.stepOrder + 1;
    const nextStep = steps.find((s) => s.stepOrder === nextStepOrder);

    if (!nextStep) {
      // Workflow is complete — approve the request
      await this.db
        .update(workflowInstances)
        .set({ currentStepOrder: currentStep.stepOrder, status: 'completed', updatedAt: new Date() })
        .where(eq(workflowInstances.id, instance.id));

      await this.db
        .update(transportRequests)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(transportRequests.id, instance.requestId));

      await this.logAuditEvent({
        entityType: 'workflow_instance',
        entityId: instance.id,
        action: 'workflow.completed',
        actorUserId: session.user.id,
        metadata: { finalStep: currentStep.stepOrder },
      }, session.tenantId);

      const [updatedInstance] = await this.db
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instance.id))
        .limit(1);

      return { ok: true, message: 'Workflow completed. Request approved.', instance: updatedInstance };
    }

    // Advance to the next step
    await this.db
      .update(workflowInstances)
      .set({ currentStepOrder: nextStepOrder, updatedAt: new Date() })
      .where(eq(workflowInstances.id, instance.id));

    // Update request status to reflect current stage
    await this.db
      .update(transportRequests)
      .set({ status: `workflow_step_${nextStepOrder}`, updatedAt: new Date() })
      .where(eq(transportRequests.id, instance.requestId));

    await this.logAuditEvent({
      entityType: 'workflow_instance',
      entityId: instance.id,
      action: 'workflow.advanced',
      actorUserId: session.user.id,
      metadata: { fromStep: currentStep.stepOrder, toStep: nextStepOrder, stepLabel: nextStep.label },
    }, session.tenantId);

    const [updatedInstance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instance.id))
      .limit(1);

    return { ok: true, message: `${currentStep.label} completed. Moved to: ${nextStep.label}.`, instance: updatedInstance };
  }

  // -------------------------------------------------------------------------
  // Emergency overrides
  // -------------------------------------------------------------------------

  /**
   * Process an emergency override that bypasses remaining workflow steps.
   *
   * Requires:
   *   - TRIP_AUTHORIZE_EMERGENCY permission
   *   - A written justification (reason)
   *   - Evidence (optional but recommended)
   *   - Post-trip review is automatically flagged
   */
  async processEmergencyOverride(
    instanceId: string,
    reason: string,
    evidence: string | undefined,
    session: AuthSession,
  ): Promise<EngineResult> {
    // Require emergency override permission
    const permCheck = await requirePermission(session, Permissions.TRIP_AUTHORIZE_EMERGENCY as PermissionCode);
    if (permCheck instanceof NextResponse) {
      return { ok: false, error: permCheck };
    }

    if (!reason?.trim()) {
      return { ok: false, error: NextResponse.json({ error: 'A justification is required for emergency override.' }, { status: 400 }) };
    }

    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      return { ok: false, error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }) };
    }

    if (instance.status !== 'active') {
      return { ok: false, error: NextResponse.json({ error: 'Workflow is not active.' }, { status: 409 }) };
    }

    // Get remaining steps (from current step onward) to log as bypassed
    const steps = await this.getDefinitionSteps(instance);
    const bypassedSteps = steps
      .filter((s) => s.stepOrder >= instance.currentStepOrder)
      .map((s) => s.stepOrder);

    // Create the emergency override record
    await this.db.insert(emergencyOverrides).values({
      instanceId,
      authorisedByUserId: session.user.id,
      reason,
      evidence: evidence ?? null,
      bypassedSteps,
      requiresPostTripReview: true,
      reviewStatus: 'pending',
    });

    // Record the override action on the current step
    await this.db.insert(workflowActions).values({
      instanceId,
      stepOrder: instance.currentStepOrder,
      actionType: steps.find((s) => s.stepOrder === instance.currentStepOrder)?.actionType ?? 'unknown',
      result: 'overridden',
      actorUserId: session.user.id,
      comment: `EMERGENCY OVERRIDE: ${reason}`,
      metadata: { isEmergency: true, bypassedSteps },
    });

    // Complete the workflow immediately
    await this.db
      .update(workflowInstances)
      .set({ status: 'overridden', updatedAt: new Date() })
      .where(eq(workflowInstances.id, instance.id));

    await this.db
      .update(transportRequests)
      .set({ status: 'approved_emergency', updatedAt: new Date() })
      .where(eq(transportRequests.id, instance.requestId));

    await this.logAuditEvent({
      entityType: 'emergency_override',
      entityId: instanceId,
      action: 'workflow.emergency_override',
      actorUserId: session.user.id,
      metadata: { reason, bypassedSteps, requiresPostTripReview: true },
    }, session.tenantId);

    const [updatedInstance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instance.id))
      .limit(1);

    return { ok: true, message: 'Emergency override applied. Workflow completed.', instance: updatedInstance };
  }

  // -------------------------------------------------------------------------
  // Workflow info
  // -------------------------------------------------------------------------

  /**
   * Get the current step and full workflow status for display purposes.
   */
  async getWorkflowStatus(instanceId: string) {
    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) return null;

    const steps = await this.getDefinitionSteps(instance);
    const actions = await this.db
      .select()
      .from(workflowActions)
      .where(eq(workflowActions.instanceId, instanceId))
      .orderBy(workflowActions.createdAt);

    const currentStep = steps.find((s) => s.stepOrder === instance.currentStepOrder) ?? null;

    const pendingSteps = steps.filter((s) => {
      return !actions.some((a) => a.stepOrder === s.stepOrder && a.result !== 'rejected' && a.result !== 'returned');
    });

    return {
      instance,
      definition: { steps },
      currentStep,
      pendingSteps,
      actions,
      isComplete: instance.status === 'completed' || instance.status === 'overridden',
      isOverridden: instance.status === 'overridden',
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the steps for a given workflow instance.
   * If the instance references a real definition, load from the DB.
   * Otherwise, return the built-in defaults based on the request scope.
   */
  private async getDefinitionSteps(instance: typeof workflowInstances.$inferSelect) {
    const isRealDefinition = instance.definitionId !== ADHOC_DEFINITION_ID;

    if (isRealDefinition) {
      const steps = await this.db
        .select()
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.definitionId, instance.definitionId),
          ),
        )
        .orderBy(workflowSteps.stepOrder);

      if (steps.length > 0) return steps;
    }

    // Fall back to built-in defaults — resolve scope from the request
    const [request] = await this.db
      .select({ scope: transportRequests.scope })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);

    const scope = request?.scope ?? 'regional';
    if (scope === 'national') return NATIONAL_WORKFLOW_STEPS as unknown as (typeof workflowSteps.$inferSelect)[];
    return REGIONAL_WORKFLOW_STEPS as unknown as (typeof workflowSteps.$inferSelect)[];
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /**
   * Send an in-app notification (and email) when a workflow action completes.
   */
  private async sendActionNotification(
    instance: typeof workflowInstances.$inferSelect,
    currentStep: { label: string },
    result: string,
    _session: AuthSession, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    try {
      // Look up the request for the requester user ID and tenant
      const [request] = await this.db
        .select({ requesterUserId: transportRequests.requesterUserId, tenantId: transportRequests.tenantId })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);

      if (!request) return;

      const titleMap: Record<string, string> = {
        approved: '✅ Request Approved',
        rejected: '❌ Request Rejected',
        returned: '↩️ Request Returned',
        released: '🚗 Vehicle Released',
        authorised: '📋 Trip Authorised',
        acknowledged: '👤 Driver Acknowledged',
        overridden: '⚠️ Emergency Override',
      };

      const title = titleMap[result] || `Workflow: ${result}`;
      const body = `Step "${currentStep.label}" completed with result: ${result}.`;

      // Create in-app notification for the requester
      await this.db.insert(notifications).values({
        tenantId: request.tenantId,
        recipientUserId: request.requesterUserId,
        type: 'outcome',
        title,
        body,
        entityType: 'workflow_instance',
        entityId: instance.id,
        actionUrl: `/dashboard/requests/${instance.requestId}`,
        priority: result === 'rejected' ? 'high' : 'normal',
      });

      // Try to send email (fire-and-forget) with correct template type mapping
      try {
        const { sendNotificationEmail } = await import('@/lib/email');
        const { employees } = await import('@/db/schema/people');
        const [emp] = await this.db
          .select({ email: employees.email, firstName: employees.firstName })
          .from(employees)
          .where(eq(employees.userId, request.requesterUserId))
          .limit(1);

        // Map workflow results to email template types
        const emailTypeMap: Record<string, string> = {
          approved: 'request_approved',
          rejected: 'request_rejected',
          returned: 'request_returned',
          released: 'vehicle_released',
          authorised: 'trip_authorised',
          overridden: 'emergency_override',
        };
        const emailType = emailTypeMap[result] || 'notification';

        if (emp?.email) {
          await sendNotificationEmail({
            to: emp.email,
            type: emailType,
            title,
            body,
            recipientName: emp.firstName || 'Staff Member',
            requestReference: instance.requestId,
            actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${instance.requestId}`,
          });
        }
      } catch {
        // Email is optional — silently skip on failure
      }
    } catch (err) {
      console.error('[Workflow] Notification failed:', err);
    }
  }

  /**
   * Log an audit event.
   */
  private async logAuditEvent(
    params: {
      entityType: string;
      entityId: string;
      action: string;
      actorUserId: string;
      metadata?: Record<string, unknown>;
    },
    tenantId: string,
  ) {
    // Audit logging is fire-and-forget — errors should not block the
    // workflow action.
    try {
      await this.db.insert(auditEvents).values({
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorUserId: params.actorUserId,
        eventType: params.action,
        tenantId,
        tenantSequence: Date.now(),
        summary: params.metadata ? JSON.stringify(params.metadata) : null,
      });
    } catch (err) {
      console.error('Failed to log workflow audit event:', err);
    }
  }
}
