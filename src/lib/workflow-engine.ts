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
  vehicleAllocations,
  employees,
  trips,
  tripAuthorities,
  rolePermissions,
  roles,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth-helpers';
import { requirePermission, forbiddenResponse } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { Permissions } from '@/lib/permissions';
import { notifications } from '@/db/schema';
import { workflowStepToStatus, workflowCompletedStatus } from '@/lib/request-status';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { resolveRoleHolder } from '@/lib/employee-lifecycle';
import { provisionTripAuthority, setAuthorityStatus } from '@/lib/trip-authority';
import { userProfiles } from '@/db/schema/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinels for ad-hoc / built-in workflow definitions */
export const ADHOC_DEFINITION_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowActionType =
  'supervisor_approve' | 'transport_review' | 'release' | 'authorise' | 'acknowledge';

export type WorkflowActionResult =
  'approved' | 'rejected' | 'returned' | 'released' | 'authorised' | 'acknowledged' | 'overridden';

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
      .select({
        scope: transportRequests.scope,
        id: transportRequests.id,
        officeId: transportRequests.officeId,
        departmentId: transportRequests.departmentId,
        regionId: transportRequests.regionId,
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

    const scope = request.scope || 'regional';

    // Try to find a matching active definition
    const definitionCandidates = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, tenantId),
          eq(workflowDefinitions.tripScope, scope),
          eq(workflowDefinitions.isActive, true),
        ),
      )
      .orderBy(workflowDefinitions.version);
    const definition = definitionCandidates
      .filter(
        (candidate) =>
          (!candidate.regionId || candidate.regionId === request.regionId) &&
          (!candidate.officeId || candidate.officeId === request.officeId) &&
          (!candidate.departmentId || candidate.departmentId === request.departmentId),
      )
      .sort((left, right) => {
        const leftSpecificity =
          Number(Boolean(left.regionId)) +
          Number(Boolean(left.officeId)) +
          Number(Boolean(left.departmentId));
        const rightSpecificity =
          Number(Boolean(right.regionId)) +
          Number(Boolean(right.officeId)) +
          Number(Boolean(right.departmentId));
        return rightSpecificity - leftSpecificity || right.version - left.version;
      })[0];

    if (!definition) {
      return {
        ok: false,
        error: NextResponse.json(
          {
            error: `No active ${scope} approval route is configured for this organisation and request.`,
          },
          { status: 409 },
        ),
      };
    }

    // If no definition exists, we use the built-in defaults
    const [instance] = await this.db
      .insert(workflowInstances)
      .values({
        requestId,
        definitionId: definition.id,
        definitionVersion: definition.version,
        currentStepOrder: 1,
        status: 'active',
      })
      .returning();

    // Link the workflow instance to the transport request
    await this.db
      .update(transportRequests)
      .set({ workflowInstanceId: instance.id, updatedAt: new Date() })
      .where(eq(transportRequests.id, requestId));

    const resolvedSteps = await this.getDefinitionSteps(instance);
    const firstStep = resolvedSteps.find((step) => step.stepOrder === 1);
    if (firstStep?.assignedUserId) {
      await this.db.insert(notifications).values({
        tenantId,
        recipientUserId: firstStep.assignedUserId,
        type: 'action_required',
        title: `Action Required — ${firstStep.label}`,
        body: 'A newly submitted transport request is awaiting your action.',
        entityType: 'workflow_instance',
        entityId: instance.id,
        actionUrl: `/dashboard/approvals/${instance.id}`,
        priority: 'high',
      });
    }

    await this.logAuditEvent(
      {
        entityType: 'workflow_instance',
        entityId: instance.id,
        action: 'workflow.initialized',
        actorUserId: 'system',
        metadata: { requestId, scope, stepCount: resolvedSteps.length },
      },
      tenantId,
    );

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
  async processAction(input: ProcessActionInput, session: AuthSession): Promise<EngineResult> {
    const { instanceId, action, result, comment } = input;

    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      return {
        ok: false,
        error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }),
      };
    }

    const [tenantRequest] = await this.db
      .select({ tenantId: transportRequests.tenantId })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    if (!tenantRequest || tenantRequest.tenantId !== session.tenantId) {
      return {
        ok: false,
        error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }),
      };
    }

    if (instance.status !== 'active') {
      return {
        ok: false,
        error: NextResponse.json(
          { error: `Workflow is already ${instance.status}.` },
          { status: 409 },
        ),
      };
    }

    // Get the current step definition
    const steps = await this.getDefinitionSteps(instance);
    const currentStep = steps.find((s) => s.stepOrder === instance.currentStepOrder);

    if (!currentStep) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'No step found at the current position.' },
          { status: 400 },
        ),
      };
    }

    if (currentStep.actionType !== action) {
      return {
        ok: false,
        error: NextResponse.json(
          {
            error: `Expected action "${currentStep.actionType}" but received "${action}".`,
          },
          { status: 400 },
        ),
      };
    }

    // Validate: comment required
    if (currentStep.requiresComment && !comment?.trim()) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'A comment is required for this action.' },
          { status: 400 },
        ),
      };
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

    if (currentStep.assignedUserId && currentStep.assignedUserId !== session.user.id) {
      return {
        ok: false,
        error: forbiddenResponse('This workflow step is assigned to another responsible user.'),
      };
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
          error: forbiddenResponse(
            'You cannot approve your own request. Another authorised person must review it.',
          ),
        };
      }
    }
    if (currentStep.separationDutyRole === 'release') {
      const [releaseAction] = await this.db
        .select({ actorUserId: workflowActions.actorUserId })
        .from(workflowActions)
        .where(
          and(
            eq(workflowActions.instanceId, instance.id),
            eq(workflowActions.actionType, 'release'),
          ),
        )
        .limit(1);
      if (releaseAction?.actorUserId === session.user.id) {
        return {
          ok: false,
          error: forbiddenResponse('The release officer cannot also perform final authorisation.'),
        };
      }
    }
    if (currentStep.actionType === 'acknowledge') {
      const [assignedDriver] = await this.db
        .select({ userId: employees.userId })
        .from(vehicleAllocations)
        .innerJoin(employees, eq(vehicleAllocations.driverEmployeeId, employees.id))
        .where(eq(vehicleAllocations.requestId, instance.requestId))
        .limit(1);
      if (!assignedDriver?.userId || assignedDriver.userId !== session.user.id) {
        return {
          ok: false,
          error: forbiddenResponse('Only the driver assigned to this request may acknowledge it.'),
        };
      }
    }
    let authorityContext: {
      allocationId: string;
      tripId: string;
      driverEmployeeId: string | null;
    } | null = null;
    if (currentStep.actionType === 'authorise') {
      const [context] = await this.db
        .select({
          allocationId: vehicleAllocations.id,
          tripId: trips.id,
          driverEmployeeId: vehicleAllocations.driverEmployeeId,
        })
        .from(vehicleAllocations)
        .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
        .where(
          and(
            eq(vehicleAllocations.requestId, instance.requestId),
            eq(trips.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (!context?.driverEmployeeId) {
        return {
          ok: false,
          error: NextResponse.json(
            {
              error: 'A vehicle and eligible driver must be allocated before final authorisation.',
            },
            { status: 409 },
          ),
        };
      }
      authorityContext = context;
    }

    // Record the action
    try {
      const [actorEmployee] = await this.db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
        .limit(1);
      const [signatureProfile] = await this.db
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
      await this.db.insert(workflowActions).values({
        instanceId: instance.id,
        stepOrder: currentStep.stepOrder,
        actionType: action,
        result,
        actorUserId: session.user.id,
        actorEmployeeId: actorEmployee?.id || null,
        roleAssignmentId:
          typeof resolution.delegationId === 'string' ? resolution.delegationId : null,
        isActing: resolution.isActing === true,
        comment: comment ?? null,
        signatureRef:
          signatureProfile?.confirmedAt &&
          ['approved', 'released', 'authorised', 'acknowledged', 'overridden'].includes(result)
            ? signatureProfile.type === 'typed'
              ? `typed:${signatureProfile.typedName || session.user.name || 'Approved'}`
              : signatureProfile.ref
            : null,
        metadata: {
          resolvedCapacity: resolution.resolvedCapacity,
          resolvedRoleId: resolution.resolvedRoleId,
          resolvedEmployeeId: resolution.resolvedEmployeeId,
          isActing: resolution.isActing === true,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return {
          ok: false,
          error: NextResponse.json(
            { error: 'This workflow step has already been completed.' },
            { status: 409 },
          ),
        };
      }
      throw error;
    }

    if (currentStep.actionType === 'authorise' && authorityContext) {
      await provisionTripAuthority({
        tripId: authorityContext.tripId,
        tenantId: session.tenantId,
        requestId: instance.requestId,
        allocationId: authorityContext.allocationId,
        actorUserId: session.user.id,
      });
    }

    if (currentStep.actionType === 'acknowledge') {
      const [actorEmployee] = await this.db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
        .limit(1);
      if (actorEmployee) {
        const [allocation] = await this.db
          .select({
            id: vehicleAllocations.id,
            authorityId: tripAuthorities.id,
            authorityStatus: tripAuthorities.status,
          })
          .from(vehicleAllocations)
          .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
          .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
          .where(eq(vehicleAllocations.requestId, instance.requestId))
          .limit(1);
        if (allocation) {
          await this.db
            .update(trips)
            .set({
              driverAcknowledgedAt: new Date(),
              driverAcknowledgedByEmployeeId: actorEmployee.id,
              updatedAt: new Date(),
            })
            .where(eq(trips.allocationId, allocation.id));
          if (allocation.authorityStatus === 'awaiting_driver_acceptance') {
            await setAuthorityStatus({
              authorityId: allocation.authorityId,
              tenantId: session.tenantId,
              next: 'driver_accepted',
              patch: {
                acceptedAt: new Date(),
                acceptedByEmployeeId: actorEmployee.id,
              },
            });
          }
        }
      }
    }

    await this.logAuditEvent(
      {
        entityType: 'workflow_action',
        entityId: instance.id,
        action: `workflow.${result}`,
        actorUserId: session.user.id,
        metadata: { stepOrder: currentStep.stepOrder, actionType: action, comment },
      },
      session.tenantId,
    );

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

    // Look up the request scope for status mapping
    const [reqRecord] = await this.db
      .select({ scope: transportRequests.scope })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    const scope: 'regional' | 'national' =
      (reqRecord?.scope as 'regional' | 'national') ?? 'regional';

    // Advance to the next step
    const nextStepOrder = currentStep.stepOrder + 1;
    const nextStep = steps.find((s) => s.stepOrder === nextStepOrder);

    if (!nextStep) {
      // Workflow is complete — approve the request
      const completedStatus = workflowCompletedStatus();
      await this.db
        .update(workflowInstances)
        .set({
          currentStepOrder: currentStep.stepOrder,
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(eq(workflowInstances.id, instance.id));

      await this.db
        .update(transportRequests)
        .set({ status: completedStatus, updatedAt: new Date() })
        .where(eq(transportRequests.id, instance.requestId));

      await this.logAuditEvent(
        {
          entityType: 'workflow_instance',
          entityId: instance.id,
          action: 'workflow.completed',
          actorUserId: session.user.id,
          metadata: { finalStep: currentStep.stepOrder },
        },
        session.tenantId,
      );

      const [updatedInstance] = await this.db
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instance.id))
        .limit(1);

      return {
        ok: true,
        message: 'Workflow completed. Request approved.',
        instance: updatedInstance,
      };
    }

    // Advance to the next step with a descriptive business status
    const businessStatus = workflowStepToStatus(nextStepOrder, nextStep.actionType, scope);
    await this.db
      .update(workflowInstances)
      .set({ currentStepOrder: nextStepOrder, updatedAt: new Date() })
      .where(eq(workflowInstances.id, instance.id));

    await this.db
      .update(transportRequests)
      .set({ status: businessStatus, updatedAt: new Date() })
      .where(eq(transportRequests.id, instance.requestId));

    await this.logAuditEvent(
      {
        entityType: 'workflow_instance',
        entityId: instance.id,
        action: 'workflow.advanced',
        actorUserId: session.user.id,
        metadata: {
          fromStep: currentStep.stepOrder,
          toStep: nextStepOrder,
          stepLabel: nextStep.label,
          businessStatus,
        },
      },
      session.tenantId,
    );

    const [updatedInstance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instance.id))
      .limit(1);

    return {
      ok: true,
      message: `${currentStep.label} completed. Moved to: ${nextStep.label}.`,
      instance: updatedInstance,
    };
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
    const permCheck = await requirePermission(
      session,
      Permissions.TRIP_AUTHORIZE_EMERGENCY as PermissionCode,
    );
    if (permCheck instanceof NextResponse) {
      return { ok: false, error: permCheck };
    }

    if (!reason?.trim()) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'A justification is required for emergency override.' },
          { status: 400 },
        ),
      };
    }

    const [instance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      return {
        ok: false,
        error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }),
      };
    }

    const [tenantRequest] = await this.db
      .select({ tenantId: transportRequests.tenantId })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    if (!tenantRequest || tenantRequest.tenantId !== session.tenantId) {
      return {
        ok: false,
        error: NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 }),
      };
    }

    if (instance.status !== 'active') {
      return {
        ok: false,
        error: NextResponse.json({ error: 'Workflow is not active.' }, { status: 409 }),
      };
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
      actionType:
        steps.find((s) => s.stepOrder === instance.currentStepOrder)?.actionType ?? 'unknown',
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

    // Emergency override sets status to a reasonable business status
    // rather than a generic 'approved_emergency'
    const nextStepOrder = instance.currentStepOrder;
    const currentStepAction =
      steps.find((s) => s.stepOrder === nextStepOrder)?.actionType ?? 'release';
    const [reqRecord] = await this.db
      .select({ scope: transportRequests.scope })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    const scope: 'regional' | 'national' =
      (reqRecord?.scope as 'regional' | 'national') ?? 'regional';
    const emergencyStatus = workflowStepToStatus(nextStepOrder, currentStepAction, scope);

    await this.db
      .update(transportRequests)
      .set({ status: emergencyStatus, updatedAt: new Date() })
      .where(eq(transportRequests.id, instance.requestId));

    await this.logAuditEvent(
      {
        entityType: 'emergency_override',
        entityId: instanceId,
        action: 'workflow.emergency_override',
        actorUserId: session.user.id,
        metadata: { reason, bypassedSteps, requiresPostTripReview: true },
      },
      session.tenantId,
    );

    const [updatedInstance] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instance.id))
      .limit(1);

    return {
      ok: true,
      message: 'Emergency override applied. Workflow completed.',
      instance: updatedInstance,
    };
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
      return !actions.some(
        (a) => a.stepOrder === s.stepOrder && a.result !== 'rejected' && a.result !== 'returned',
      );
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
        .where(and(eq(workflowSteps.definitionId, instance.definitionId)))
        .orderBy(workflowSteps.stepOrder);

      if (steps.length > 0) return this.resolveStepAssignments(steps, instance.requestId);
    }

    // Fall back to built-in defaults — resolve scope from the request
    const [request] = await this.db
      .select({ scope: transportRequests.scope })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);

    const scope = request?.scope ?? 'regional';
    const fallback =
      scope === 'national'
        ? (NATIONAL_WORKFLOW_STEPS as unknown as (typeof workflowSteps.$inferSelect)[])
        : (REGIONAL_WORKFLOW_STEPS as unknown as (typeof workflowSteps.$inferSelect)[]);
    return this.resolveStepAssignments(fallback, instance.requestId);
  }

  private async resolveStepAssignments(
    steps: (typeof workflowSteps.$inferSelect)[],
    requestId: string,
  ) {
    const requestRows = await this.db
      .select({ tenantId: transportRequests.tenantId })
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);
    if (!Array.isArray(requestRows)) return steps;
    const [request] = requestRows;
    if (!request) return steps;
    return Promise.all(
      steps.map(async (step) => {
        if (!step.requiredPermission || step.actionType === 'acknowledge') return step;
        const roleQuery = this.db.select({ roleId: roles.id }).from(roles);
        if (typeof (roleQuery as { innerJoin?: unknown }).innerJoin !== 'function') return step;
        const roleRows = await roleQuery
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .where(
            and(
              eq(roles.tenantId, request.tenantId),
              eq(rolePermissions.permissionCode, step.requiredPermission),
            ),
          );
        const capability =
          step.actionType === 'authorise'
            ? 'sign'
            : step.actionType === 'release'
              ? 'allocate'
              : 'approve';
        for (const role of roleRows) {
          const holder = await resolveRoleHolder({
            tenantId: request.tenantId,
            roleId: role.roleId,
            requireCapability: capability,
          });
          if (holder?.userId) {
            return {
              ...step,
              assignedUserId: holder.userId,
              config: {
                ...(step.config || {}),
                resolvedRoleId: role.roleId,
                resolvedEmployeeId: holder.employeeId,
                resolvedCapacity: holder.capacity,
                isActing: holder.isActing,
                delegationId: 'delegationId' in holder ? holder.delegationId : null,
              },
            };
          }
        }
        return step;
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /**
   * Send an in-app notification (and email) when a workflow action completes.
   */
  private async sendActionNotification(
    instance: typeof workflowInstances.$inferSelect,
    currentStep: { label: string; stepOrder: number },
    result: string,
    _session: AuthSession, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    try {
      // Look up the request for the requester user ID and tenant
      const [request] = await this.db
        .select({
          requesterUserId: transportRequests.requesterUserId,
          tenantId: transportRequests.tenantId,
          reference: transportRequests.reference,
        })
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
      await recordTenantRequestActivity({
        tenantId: request.tenantId,
        requestId: instance.requestId,
        reference: request.reference,
        stage: result,
        officeLabel: currentStep.label,
      });

      // Secure-link requests have no login account; their outcome is delivered
      // through the tracking link/email rather than an internal notification.
      if (request.requesterUserId) {
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
      }

      if (!['rejected', 'returned'].includes(result)) {
        const steps = await this.getDefinitionSteps(instance);
        const nextStep = steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
        if (nextStep?.assignedUserId && nextStep.assignedUserId !== request.requesterUserId) {
          await this.db.insert(notifications).values({
            tenantId: request.tenantId,
            recipientUserId: nextStep.assignedUserId,
            type: 'action_required',
            title: `Action Required — ${nextStep.label}`,
            body: `A transport request is awaiting your ${nextStep.label.toLowerCase()} action.`,
            entityType: 'workflow_instance',
            entityId: instance.id,
            actionUrl: `/dashboard/approvals/${instance.id}`,
            priority: 'high',
          });
        }
      }

      // Try to send email (fire-and-forget) with correct template type mapping
      try {
        const { sendNotificationEmail } = await import('@/lib/email');
        const { employees } = await import('@/db/schema/people');
        const [emp] = request.requesterUserId
          ? await this.db
              .select({ email: employees.email, firstName: employees.firstName })
              .from(employees)
              .where(eq(employees.userId, request.requesterUserId))
              .limit(1)
          : [undefined];

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
        summary: `${params.entityType.replaceAll('_', ' ')} ${params.action.replaceAll('_', ' ')}`,
        after: params.metadata || null,
      });
    } catch (err) {
      console.error('Failed to log workflow audit event:', err);
    }
  }
}
