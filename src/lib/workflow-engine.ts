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
import { eq, and, sql, lte, or, isNull, gt, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth-helpers';
import { requirePermission, forbiddenResponse } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { Permissions } from '@/lib/permissions';
import { tenantMemberships, roleAssignments } from '@/db/schema';
import { workflowStepToStatus, workflowCompletedStatus } from '@/lib/request-status';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { resolveRoleHolder } from '@/lib/employee-lifecycle';
import { provisionTripAuthority, setAuthorityStatus } from '@/lib/trip-authority';
import { userProfiles } from '@/db/schema/auth';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolvePermissionRecipients,
} from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';

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
export const REGIONAL_WORKFLOW_STEPS = [
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

/** Steps for a national-scope trip using the same five-stage contract. */
export const NATIONAL_WORKFLOW_STEPS = [
  ...REGIONAL_WORKFLOW_STEPS.slice(0, 2),
  {
    stepOrder: 3,
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
    stepOrder: 4,
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
    stepOrder: 5,
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
    // Schedule the first step's reminder + escalation timers (the caller no
    // longer hardcodes step 1 at request creation — resubmits and public
    // submissions get the same timers through this single path).
    if (firstStep) this.scheduleStepTimers(instance.id, firstStep);
    if (firstStep?.assignedUserId) {
      await createScopedNotifications({
        tenantId,
        recipientUserIds: [firstStep.assignedUserId],
        category: 'action_required',
        eventType: 'approval_assigned',
        title: `Action Required — ${firstStep.label}`,
        body: 'A newly submitted transport request is awaiting your action.',
        entityType: 'workflow_instance',
        entityId: instance.id,
        actionUrl: `/dashboard/approvals/${instance.id}`,
        workspace: WorkspaceIds.APPROVER,
        workflowStage: String(firstStep.stepOrder),
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
    } // Validate: separation of duty — conflict-of-interest detection
    if (currentStep.separationDutyRole === 'requester') {
      const [request] = await this.db
        .select({
          requesterUserId: transportRequests.requesterUserId,
          travellerEmployeeId: transportRequests.travellerEmployeeId,
          requesterEmployeeId: transportRequests.requesterEmployeeId,
          id: transportRequests.id,
        })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);

      const isRequester = request && request.requesterUserId === session.user.id;
      // Also check if the actor is the main traveller/beneficiary
      let isTraveller = false;
      if (request && !isRequester) {
        const [actorEmployee] = await this.db
          .select({ id: employees.id })
          .from(employees)
          .where(
            and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)),
          )
          .limit(1);
        if (
          actorEmployee &&
          (request.travellerEmployeeId === actorEmployee.id ||
            request.requesterEmployeeId === actorEmployee.id)
        ) {
          isTraveller = true;
        }
      }

      if (isRequester || isTraveller) {
        // CONFLICT DETECTED — attempt auto-reassignment to an alternate officer
        const resolution = await this.resolveAlternateOfficer(instance, currentStep, session);
        if (resolution) {
          // The step was reassigned — notify the original actor and the replacement
          await this.logAuditEvent(
            {
              entityType: 'workflow_instance',
              entityId: instance.id,
              action: 'workflow.conflict_reassigned',
              actorUserId: session.user.id,
              metadata: {
                conflictedUserId: session.user.id,
                originalStepOrder: currentStep.stepOrder,
                reassignedToUserId: resolution.reassignedUserId,
                reason: isRequester
                  ? 'Requester-authoriser conflict detected'
                  : 'Traveller-authoriser conflict detected',
                alternateEmployeeName: resolution.alternateName,
                reassignmentMethod: resolution.method,
              },
            },
            session.tenantId,
          );

          return {
            ok: false,
            error: NextResponse.json(
              {
                error: `Conflict of interest detected: you are ${
                  isRequester ? 'the requester' : 'a traveller'
                } on this request. This step has been reassigned to ${resolution.alternateName}.`,
                conflictReassigned: true,
                reassignedTo: resolution.alternateName,
              },
              { status: 409 },
            ),
          };
        }

        // No alternate found — block with clear message
        return {
          ok: false,
          error: forbiddenResponse(
            'You cannot approve your own request or act on a trip where you are a traveller. No eligible alternate officer could be assigned automatically. Please contact your Tenant Administrator.',
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

    await resolveActionNotifications({
      tenantId: session.tenantId,
      entityType: 'workflow_instance',
      entityId: instance.id,
      eventTypes: ['approval_assigned', 'approval_conflict_reassigned'],
    });

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

    // Chain the reminder + escalation timers for the step we just entered.
    this.scheduleStepTimers(instance.id, nextStep);

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
   * Resolve the users who can currently act on a workflow's active step.
   *
   * Mirrors the approvals queue visibility model (`activeApprovalVisibleTo`)
   * and the action-time authorization gates:
   *   1. A runtime-resolved explicit holder (delegation / acting role) wins.
   *   2. The acknowledge step is never pre-assigned in the DB — the allocated
   *      driver is resolved dynamically from the vehicle allocation.
   *   3. Otherwise every active user holding the step's required permission
   *      (the population the queue's permission branch surfaces the step to).
   *
   * Used by the Inngest reminder/escalation jobs so permission-routed steps
   * are not left without any recipient.
   */
  async getCurrentStepRecipients(instanceId: string, tenantId: string): Promise<string[]> {
    const status = await this.getWorkflowStatus(instanceId);
    const currentStep = status?.currentStep;
    if (!currentStep) return [];

    if (currentStep.assignedUserId) return [currentStep.assignedUserId];

    if (currentStep.actionType === 'acknowledge') {
      const [allocated] = await this.db
        .select({ userId: employees.userId })
        .from(vehicleAllocations)
        .innerJoin(employees, eq(vehicleAllocations.driverEmployeeId, employees.id))
        .where(eq(vehicleAllocations.requestId, status.instance.requestId))
        .orderBy(vehicleAllocations.createdAt)
        .limit(1);
      return allocated?.userId ? [allocated.userId] : [];
    }

    if (currentStep.requiredPermission) {
      return resolvePermissionRecipients(tenantId, currentStep.requiredPermission);
    }

    return [];
  }

  /**
   * Schedule the Inngest reminder + escalation timers for a workflow step.
   * Fire-and-forget and best-effort: Inngest is optional, and a slow or
   * unconfigured client must never block an action/creation request.
   */
  private scheduleStepTimers(
    instanceId: string,
    step: { stepOrder: number; reminderAfterHours?: number | null; escalationAfterHours?: number | null },
  ) {
    void (async () => {
      try {
        const { scheduleStepReminder, scheduleStepEscalation } = await import('@/lib/inngest/client');
        await Promise.all([
          scheduleStepReminder(instanceId, step.stepOrder, step.reminderAfterHours ?? 2),
          scheduleStepEscalation(instanceId, step.stepOrder, step.escalationAfterHours ?? 4),
        ]);
      } catch {
        // Inngest is optional — silently skip if not configured
      }
    })();
  }

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
        // The acknowledge step must NOT have a pre-assigned user — the
        // actual assigned driver is resolved dynamically at action time by
        // looking up the allocation's driverEmployeeId.  Null out any stale
        // assignedUserId that may have been set in the DB definition.
        if (step.actionType === 'acknowledge') {
          return { ...step, assignedUserId: null };
        }
        if (!step.requiredPermission) return step;
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
  // Conflict-of-interest: alternate officer resolution
  // -------------------------------------------------------------------------

  /**
   * When a conflict-of-interest is detected (officer is the requester or a
   * traveller on the request), attempt to find an alternate officer for the
   * current workflow step.
   *
   * Strategy:
   *   1. Look for an acting delegation for the conflicted role that is active
   *      and has the required capability.
   *   2. Fall back to any other employee in the tenant with the same permission.
   *   3. Exclude the conflicted user and anyone else on the request.
   *
   * Returns null if no eligible alternate can be found.
   */
  private async resolveAlternateOfficer(
    instance: typeof workflowInstances.$inferSelect,
    currentStep: typeof workflowSteps.$inferSelect & { label?: string },
    session: AuthSession,
  ): Promise<{
    reassignedUserId: string;
    alternateName: string;
    method: 'acting_delegation' | 'same_role' | 'tenant_admin';
  } | null> {
    try {
      // Look up the tenant
      const [tenantRequest] = await this.db
        .select({ tenantId: transportRequests.tenantId })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);
      if (!tenantRequest) return null;

      const tenantId = tenantRequest.tenantId;

      // Get the role IDs that grant the required permission
      const permissionCode = currentStep.requiredPermission;
      if (!permissionCode) return null;

      const roleRows = await this.db
        .select({ roleId: roles.id })
        .from(roles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(
          and(
            eq(roles.tenantId, tenantId),
            eq(rolePermissions.permissionCode, permissionCode as string),
          ),
        );

      if (roleRows.length === 0) return null;

      // Get the requester/traveller employee IDs to exclude
      const [requestInfo] = await this.db
        .select({
          requesterUserId: transportRequests.requesterUserId,
          requesterEmployeeId: transportRequests.requesterEmployeeId,
          travellerEmployeeId: transportRequests.travellerEmployeeId,
        })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);

      const excludeUserIds: string[] = [session.user.id];
      if (requestInfo?.requesterUserId && requestInfo.requesterUserId !== session.user.id) {
        excludeUserIds.push(requestInfo.requesterUserId);
      }

      const now = new Date();

      for (const role of roleRows) {
        const capability =
          currentStep.actionType === 'authorise'
            ? 'sign'
            : currentStep.actionType === 'release'
              ? 'allocate'
              : 'approve';

        // 1. Try acting delegations first
        const actingColumns = {
          approve: 'can_approve',
          sign: 'can_sign',
          allocate: 'can_allocate_vehicles',
          assign_driver: 'can_assign_drivers',
          reconcile: 'can_reconcile_trips',
        };

        const actingResult = await this.db.execute(
          sql`
            SELECT rd.id as delegation_id, e.id as employee_id, e.user_id, e.first_name, e.last_name
            FROM role_delegations rd
            INNER JOIN employees e ON e.id = rd.acting_employee_id
            WHERE rd.role_id = ${role.roleId}
              AND rd.tenant_id = ${tenantId}
              AND rd.status IN ('scheduled', 'active')
              AND rd.start_at <= ${now}
              AND rd.end_at > ${now}
              AND rd.${sql.identifier(actingColumns[capability])} = true
              AND e.employment_status = 'active'
              AND e.availability_status = 'available'
              AND e.user_id NOT IN (${sql.join(
                excludeUserIds.map((uid) => sql`${uid}`),
                sql`, `,
              )})
            LIMIT 1
          `,
        );

        const actingRow = actingResult.rows?.[0] as Record<string, unknown> | undefined;
        if (actingRow && actingRow.user_id) {
          const reassignedUserId = String(actingRow.user_id);
          const alternateName =
            `${actingRow.first_name || ''} ${actingRow.last_name || ''}`.trim() ||
            'Alternate Officer';

          // Update the step assignment to the alternate
          await this.db
            .update(workflowSteps)
            .set({
              assignedUserId: reassignedUserId,
              config: {
                ...(currentStep.config || {}),
                conflictReassigned: true,
                conflictedUserId: session.user.id,
                reassignedAt: now.toISOString(),
                reassignmentReason: 'Requester-authoriser conflict',
              },
            })
            .where(
              and(
                eq(workflowSteps.id, currentStep.id),
                eq(workflowSteps.stepOrder, currentStep.stepOrder),
              ),
            );

          // Notify the alternate
          await createScopedNotifications({
            tenantId,
            recipientUserIds: [reassignedUserId],
            category: 'action_required',
            eventType: 'approval_conflict_reassigned',
            title: `Conflict Reassignment — ${currentStep.label || 'Step'} Action Required`,
            body: `A workflow step has been reassigned to you because the original officer has a conflict of interest on this request.`,
            entityType: 'workflow_instance',
            entityId: instance.id,
            actionUrl: `/dashboard/approvals/${instance.id}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(currentStep.stepOrder),
            priority: 'high',
          });

          return {
            reassignedUserId,
            alternateName,
            method: 'acting_delegation',
          };
        }

        // 2. Try same-role holders (substantive assignments)
        const [sameRole] = await this.db
          .select({
            id: employees.id,
            userId: employees.userId,
            firstName: employees.firstName,
            lastName: employees.lastName,
          })
          .from(tenantMemberships)
          .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .innerJoin(
            employees,
            and(eq(employees.userId, tenantMemberships.userId), eq(employees.tenantId, tenantId)),
          )
          .where(
            and(
              eq(tenantMemberships.tenantId, tenantId),
              eq(roleAssignments.roleId, role.roleId),
              eq(roleAssignments.isActing, false),
              lte(roleAssignments.startDate, now),
              or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
              eq(employees.employmentStatus, 'active'),
              eq(employees.availabilityStatus, 'available'),
              ne(employees.userId, session.user.id),
              requestInfo?.requesterUserId
                ? ne(employees.userId, requestInfo.requesterUserId)
                : sql`true`,
            ),
          )
          .limit(1);

        if (sameRole?.userId) {
          const alternateName =
            `${sameRole.firstName || ''} ${sameRole.lastName || ''}`.trim() || 'Alternate Officer';

          await this.db
            .update(workflowSteps)
            .set({
              assignedUserId: sameRole.userId,
              config: {
                ...(currentStep.config || {}),
                conflictReassigned: true,
                conflictedUserId: session.user.id,
                reassignedAt: now.toISOString(),
                reassignmentReason: 'Requester-authoriser conflict',
              },
            })
            .where(
              and(
                eq(workflowSteps.id, currentStep.id),
                eq(workflowSteps.stepOrder, currentStep.stepOrder),
              ),
            );

          await createScopedNotifications({
            tenantId,
            recipientUserIds: [sameRole.userId],
            category: 'action_required',
            eventType: 'approval_conflict_reassigned',
            title: `Conflict Reassignment — ${currentStep.label || 'Step'} Action Required`,
            body: `A workflow step has been reassigned to you because the original officer has a conflict of interest.`,
            entityType: 'workflow_instance',
            entityId: instance.id,
            actionUrl: `/dashboard/approvals/${instance.id}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(currentStep.stepOrder),
            priority: 'high',
          });

          return {
            reassignedUserId: sameRole.userId,
            alternateName,
            method: 'same_role',
          };
        }
      }

      return null;
    } catch (err) {
      console.error('[Workflow] Failed to resolve alternate officer:', err);
      return null;
    }
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
        await createScopedNotifications({
          tenantId: request.tenantId,
          recipientUserIds: [request.requesterUserId],
          category: result === 'returned' ? 'action_required' : 'outcome',
          eventType: `request_${result}`,
          title,
          body,
          entityType: 'workflow_instance',
          entityId: instance.id,
          actionUrl: `/dashboard/requests/${instance.requestId}`,
          workspace: WorkspaceIds.PERSONAL,
          workflowStage: String(currentStep.stepOrder),
          priority: result === 'rejected' ? 'high' : 'normal',
        });
      }

      if (!['rejected', 'returned'].includes(result)) {
        const steps = await this.getDefinitionSteps(instance);
        const nextStep = steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
        if (nextStep?.assignedUserId && nextStep.assignedUserId !== request.requesterUserId) {
          await createScopedNotifications({
            tenantId: request.tenantId,
            recipientUserIds: [nextStep.assignedUserId],
            category: 'action_required',
            eventType: 'approval_assigned',
            title: `Action Required — ${nextStep.label}`,
            body: `A transport request is awaiting your ${nextStep.label.toLowerCase()} action.`,
            entityType: 'workflow_instance',
            entityId: instance.id,
            actionUrl: `/dashboard/approvals/${instance.id}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(nextStep.stepOrder),
            priority: 'high',
          });
        }
      }

      // Send email fire-and-forget — never block the approval on an outbound
      // network call (Resend + React Email template loading can take seconds
      // on a cold path). In-app notifications above are already persisted,
      // which is what tests and the UI rely on.
      void (async () => {
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
      })();
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
