/**
 * Workflow Engine
 *
 * State machine that manages transport request approval workflows through
 * defined governance gates followed by the locked operational lifecycle:
 * transport_review → optional release → authorise → acknowledge.
 *
 * Each workflow definition is versioned per tenant and trip scope (regional
 * vs national). The engine validates permissions, separation of duty,
 * preserves historical override outcomes, and records every action in the audit log.
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
  transportRequests,
  auditEvents,
  vehicleAllocations,
  employees,
  trips,
  rolePermissions,
  roles,
} from '@/db/schema';
import { eq, and, desc, sql, lte, or, isNull, gt, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth-helpers';
import { requirePermission, forbiddenResponse } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { Permissions } from '@/lib/permissions';
import { tenantMemberships, roleAssignments } from '@/db/schema';
import { workflowStepToStatus, workflowCompletedStatus } from '@/lib/request-status';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { resolveRoleHolder } from '@/lib/employee-lifecycle';
import { provisionTripAuthority } from '@/lib/trip-authority';
import { userProfiles } from '@/db/schema/auth';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolvePermissionRecipients,
} from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';
import { normalizeAssignmentConfig, type AssignmentStrategy } from '@/lib/workflow-builder';
import {
  normaliseFinancialImpact,
  normaliseRequestOrigin,
  resolveWorkflowRoute,
  type WorkflowRouteContext,
} from '@/lib/workflow-route-resolver';

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
  | 'organisational_approve'
  | 'finance_review'
  | 'transport_review'
  | 'release'
  | 'authorise'
  | 'acknowledge';

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
    allowsEmergencyOverride: false,
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
    allowsEmergencyOverride: false,
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
    allowsEmergencyOverride: false,
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
    allowsEmergencyOverride: false,
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
   * Looks up the active tenant definition using the request's frozen routing
   * criteria. Existing definitions with null conditions remain wildcards.
   */
  async initializeForRequest(requestId: string, tenantId: string): Promise<EngineResult> {
    const [request] = await this.db
      .select({
        scope: transportRequests.scope,
        id: transportRequests.id,
        officeId: transportRequests.officeId,
        departmentId: transportRequests.departmentId,
        regionId: transportRequests.regionId,
        requesterType: transportRequests.requesterType,
        requestOrigin: transportRequests.requestOrigin,
        financialImpact: transportRequests.financialImpact,
        tripCategory: transportRequests.tripCategory,
        programmeId: transportRequests.programmeId,
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
    const routingContext: WorkflowRouteContext = {
      tripScope: scope,
      regionId: request.regionId,
      officeId: request.officeId,
      departmentId: request.departmentId,
      requestOrigin: normaliseRequestOrigin(
        request.requestOrigin || request.requesterType,
        Boolean(request.programmeId),
      ),
      financialImpact: normaliseFinancialImpact(request.financialImpact),
      tripCategory: request.tripCategory?.trim() || 'general',
    };

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
    const routeResolution = resolveWorkflowRoute(definitionCandidates, routingContext);

    if (routeResolution.status === 'no_match') {
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
    if (routeResolution.status === 'ambiguous') {
      return {
        ok: false,
        error: NextResponse.json(
          {
            error:
              'Multiple equally specific approval routes match this request. A Tenant Administrator must resolve the overlapping workflow definitions before submission.',
            conflictingDefinitionIds: routeResolution.candidates.map((candidate) => candidate.id),
          },
          { status: 409 },
        ),
      };
    }
    const definition = routeResolution.definition;

    const [instance] = await this.db
      .insert(workflowInstances)
      .values({
        requestId,
        definitionId: definition.id,
        definitionVersion: definition.version,
        currentStepOrder: 1,
        status: 'active',
        routingContext: {
          ...routingContext,
          definitionId: definition.id,
          definitionVersion: definition.version,
          specificity: routeResolution.specificity,
          selectedAt: new Date().toISOString(),
        },
      })
      .returning();

    await this.db
      .update(transportRequests)
      .set({ workflowInstanceId: instance.id, updatedAt: new Date() })
      .where(eq(transportRequests.id, requestId));

    const resolvedSteps = await this.getDefinitionSteps(instance);
    const firstStep = resolvedSteps.find((step) => step.stepOrder === 1);
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

    if (currentStep.actionType === 'acknowledge') {
      return {
        ok: false,
        error: NextResponse.json(
          {
            error:
              'Driver acknowledgement must be completed from the assigned trip in Driver Console.',
            actionUrl: '/dashboard/trips',
          },
          { status: 409 },
        ),
      };
    }

    if (currentStep.requiresComment && !comment?.trim()) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'A comment is required for this action.' },
          { status: 400 },
        ),
      };
    }

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
        const resolution = await this.resolveAlternateOfficer(instance, currentStep, session);
        if (resolution) {
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

    await this.sendActionNotification(instance, currentStep, result, session).catch(() => {});

    if (result === 'rejected' || result === 'returned') {
      const newStatus = result === 'rejected' ? 'rejected' : 'returned';
      await this.db
        .update(workflowInstances)
        .set({
          status: 'cancelled',
          currentAssignedUserId: null,
          currentAssignmentMeta: {},
          updatedAt: new Date(),
        })
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

    const [reqRecord] = await this.db
      .select({ scope: transportRequests.scope })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    const scope: 'regional' | 'national' =
      (reqRecord?.scope as 'regional' | 'national') ?? 'regional';

    const nextStepOrder = currentStep.stepOrder + 1;
    const nextStep = steps.find((s) => s.stepOrder === nextStepOrder);

    if (!nextStep) {
      const completedStatus = workflowCompletedStatus();
      await this.db
        .update(workflowInstances)
        .set({
          currentStepOrder: currentStep.stepOrder,
          status: 'completed',
          currentAssignedUserId: null,
          currentAssignmentMeta: {},
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

    const businessStatus = workflowStepToStatus(nextStepOrder, nextStep.actionType, scope);
    await this.db
      .update(workflowInstances)
      .set({
        currentStepOrder: nextStepOrder,
        currentAssignedUserId: null,
        currentAssignmentMeta: {},
        updatedAt: new Date(),
      })
      .where(eq(workflowInstances.id, instance.id));

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
  // Retired emergency override compatibility surface
  // -------------------------------------------------------------------------

  /**
   * Legacy compatibility method retained so old callers fail safely.
   * Historical emergency-override rows remain readable, but no new override
   * can bypass the configured release/final-authorisation workflow.
   */
  async processEmergencyOverride(
    _instanceId: string,
    _reason: string,
    _evidence: string | undefined,
    _session: AuthSession,
  ): Promise<EngineResult> {
    return {
      ok: false,
      error: forbiddenResponse(
        'Emergency workflow override has been retired. Use the configured release and final-authorisation workflow.',
      ),
    };
  }

  async getCurrentStepRecipients(instanceId: string, tenantId: string): Promise<string[]> {
    const status = await this.getWorkflowStatus(instanceId);
    const currentStep = status?.currentStep;
    if (!currentStep) return [];

    if (currentStep.assignedUserId) return [currentStep.assignedUserId];

    if (currentStep.actionType === 'acknowledge') {
      const [allocated] = await this.db
        .select({ userId: employees.userId })
        .from(vehicleAllocations)
        .innerJoin(
          trips,
          and(
            eq(trips.allocationId, vehicleAllocations.id),
            eq(trips.requestId, vehicleAllocations.requestId),
          ),
        )
        .innerJoin(
          employees,
          and(
            eq(vehicleAllocations.driverEmployeeId, employees.id),
            eq(employees.tenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(vehicleAllocations.requestId, status.instance.requestId),
            eq(vehicleAllocations.state, 'confirmed'),
            eq(trips.tenantId, tenantId),
            eq(trips.requestId, status.instance.requestId),
          ),
        )
        .orderBy(desc(vehicleAllocations.updatedAt), desc(vehicleAllocations.createdAt))
        .limit(1);
      return allocated?.userId ? [allocated.userId] : [];
    }

    if (currentStep.requiredPermission) {
      return resolvePermissionRecipients(tenantId, currentStep.requiredPermission);
    }

    return [];
  }

  private scheduleStepTimers(
    instanceId: string,
    step: {
      stepOrder: number;
      reminderAfterHours?: number | null;
      escalationAfterHours?: number | null;
    },
  ) {
    void (async () => {
      try {
        const { scheduleStepReminder, scheduleStepEscalation } =
          await import('@/lib/inngest/client');
        await Promise.all([
          scheduleStepReminder(instanceId, step.stepOrder, step.reminderAfterHours ?? 2),
          scheduleStepEscalation(instanceId, step.stepOrder, step.escalationAfterHours ?? 4),
        ]);
      } catch {}
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

  private async getDefinitionSteps(instance: typeof workflowInstances.$inferSelect) {
    const isRealDefinition = instance.definitionId !== ADHOC_DEFINITION_ID;

    if (isRealDefinition) {
      const steps = await this.db
        .select()
        .from(workflowSteps)
        .where(and(eq(workflowSteps.definitionId, instance.definitionId)))
        .orderBy(workflowSteps.stepOrder);

      if (steps.length > 0) return this.resolveStepAssignments(steps, instance);
    }

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
    return this.resolveStepAssignments(fallback, instance);
  }

  private async resolveStepAssignments(
    steps: (typeof workflowSteps.$inferSelect)[],
    instance: typeof workflowInstances.$inferSelect,
  ) {
    const requestRows = await this.db
      .select({
        tenantId: transportRequests.tenantId,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        departmentId: transportRequests.departmentId,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    if (!Array.isArray(requestRows)) return steps;
    const [request] = requestRows;
    if (!request) return steps;
    return Promise.all(
      steps.map(async (step) => {
        if (step.actionType === 'acknowledge') {
          return { ...step, assignedUserId: null };
        }

        if (step.stepOrder === instance.currentStepOrder && instance.currentAssignedUserId) {
          return {
            ...step,
            assignedUserId: instance.currentAssignedUserId,
            config: {
              ...(step.config || {}),
              ...(instance.currentAssignmentMeta || {}),
            },
          };
        }

        if (!step.requiredPermission) return step;
        const assignmentConfig = normalizeAssignmentConfig(step.config, step.assignedUserId);

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
        const strategies = [
          assignmentConfig.assignmentStrategy,
          ...assignmentConfig.fallbackStrategies,
        ].filter((value, index, values) => values.indexOf(value) === index);

        const resolved = async (strategy: AssignmentStrategy) => {
          if (strategy === 'responsible_sponsor') {
            const [sponsor] = await this.db
              .select({
                userId: employees.userId,
                employeeId: employees.id,
                employmentStatus: employees.employmentStatus,
                availabilityStatus: employees.availabilityStatus,
              })
              .from(employees)
              .where(
                and(
                  eq(employees.id, request.requesterEmployeeId),
                  eq(employees.tenantId, request.tenantId),
                ),
              )
              .limit(1);
            if (
              !sponsor?.userId ||
              sponsor.employmentStatus !== 'active' ||
              sponsor.availabilityStatus === 'unavailable'
            ) {
              return null;
            }
            const [grant] = await this.db
              .select({ userId: tenantMemberships.userId })
              .from(tenantMemberships)
              .innerJoin(
                roleAssignments,
                eq(roleAssignments.tenantMembershipId, tenantMemberships.id),
              )
              .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
              .where(
                and(
                  eq(tenantMemberships.tenantId, request.tenantId),
                  eq(tenantMemberships.userId, sponsor.userId),
                  eq(tenantMemberships.status, 'active'),
                  eq(rolePermissions.permissionCode, step.requiredPermission!),
                  lte(roleAssignments.startDate, new Date()),
                  or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, new Date())),
                ),
              )
              .limit(1);
            return grant
              ? { userId: sponsor.userId, employeeId: sponsor.employeeId, strategy }
              : null;
          }
          if (strategy === 'named_user') {
            if (!step.assignedUserId) return null;
            const [person] = await this.db
              .select({
                userId: employees.userId,
                employeeId: employees.id,
                employmentStatus: employees.employmentStatus,
                availabilityStatus: employees.availabilityStatus,
              })
              .from(employees)
              .where(
                and(
                  eq(employees.tenantId, request.tenantId),
                  eq(employees.userId, step.assignedUserId),
                ),
              )
              .limit(1);
            if (
              !person?.userId ||
              person.employmentStatus !== 'active' ||
              person.availabilityStatus === 'unavailable'
            )
              return null;
            const [grant] = await this.db
              .select({ userId: tenantMemberships.userId })
              .from(tenantMemberships)
              .innerJoin(
                roleAssignments,
                eq(roleAssignments.tenantMembershipId, tenantMemberships.id),
              )
              .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
              .where(
                and(
                  eq(tenantMemberships.tenantId, request.tenantId),
                  eq(tenantMemberships.userId, person.userId),
                  eq(tenantMemberships.status, 'active'),
                  eq(rolePermissions.permissionCode, step.requiredPermission!),
                  lte(roleAssignments.startDate, new Date()),
                  or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, new Date())),
                ),
              )
              .limit(1);
            return grant
              ? { userId: person.userId, employeeId: person.employeeId, strategy }
              : null;
          }
          if (strategy === 'requester_supervisor') {
            const [requester] = await this.db
              .select({ supervisorEmployeeId: employees.supervisorEmployeeId })
              .from(employees)
              .where(
                and(
                  eq(employees.id, request.requesterEmployeeId),
                  eq(employees.tenantId, request.tenantId),
                ),
              )
              .limit(1);
            if (!requester?.supervisorEmployeeId) return null;
            const [supervisor] = await this.db
              .select({
                userId: employees.userId,
                employeeId: employees.id,
                employmentStatus: employees.employmentStatus,
                availabilityStatus: employees.availabilityStatus,
              })
              .from(employees)
              .where(
                and(
                  eq(employees.id, requester.supervisorEmployeeId),
                  eq(employees.tenantId, request.tenantId),
                ),
              )
              .limit(1);
            if (
              !supervisor?.userId ||
              supervisor.employmentStatus !== 'active' ||
              supervisor.availabilityStatus === 'unavailable'
            )
              return null;
            const [grant] = await this.db
              .select({ userId: tenantMemberships.userId })
              .from(tenantMemberships)
              .innerJoin(
                roleAssignments,
                eq(roleAssignments.tenantMembershipId, tenantMemberships.id),
              )
              .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
              .where(
                and(
                  eq(tenantMemberships.tenantId, request.tenantId),
                  eq(tenantMemberships.userId, supervisor.userId),
                  eq(tenantMemberships.status, 'active'),
                  eq(rolePermissions.permissionCode, step.requiredPermission!),
                  lte(roleAssignments.startDate, new Date()),
                  or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, new Date())),
                ),
              )
              .limit(1);
            return grant
              ? { userId: supervisor.userId, employeeId: supervisor.employeeId, strategy }
              : null;
          }
          for (const role of roleRows) {
            const holder = await resolveRoleHolder({
              tenantId: request.tenantId,
              roleId: role.roleId,
              requireCapability: capability,
            });
            if (!holder?.userId) continue;
            if (strategy === 'department_permission_pool') {
              const [employee] = await this.db
                .select({ departmentId: employees.departmentId })
                .from(employees)
                .where(
                  and(
                    eq(employees.id, holder.employeeId),
                    eq(employees.tenantId, request.tenantId),
                  ),
                )
                .limit(1);
              if (!request.departmentId || employee?.departmentId !== request.departmentId)
                continue;
            }
            return { ...holder, strategy, roleId: role.roleId };
          }
          return null;
        };

        for (const strategy of strategies) {
          const holder = await resolved(strategy);
          if (!holder?.userId) continue;
          return {
            ...step,
            assignedUserId: holder.userId,
            config: {
              ...assignmentConfig,
              resolvedStrategy: strategy,
              resolvedRoleId: 'roleId' in holder ? holder.roleId : null,
              resolvedEmployeeId: holder.employeeId,
              resolvedCapacity: 'capacity' in holder ? holder.capacity : null,
              isActing: 'isActing' in holder ? holder.isActing : false,
              delegationId: 'delegationId' in holder ? holder.delegationId : null,
            },
          };
        }
        return step;
      }),
    );
  }

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
      const [tenantRequest] = await this.db
        .select({ tenantId: transportRequests.tenantId })
        .from(transportRequests)
        .where(eq(transportRequests.id, instance.requestId))
        .limit(1);
      if (!tenantRequest) return null;

      const tenantId = tenantRequest.tenantId;
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

          const [reassignedInstance] = await this.db
            .update(workflowInstances)
            .set({
              currentAssignedUserId: reassignedUserId,
              currentAssignmentMeta: {
                ...(currentStep.config || {}),
                conflictReassigned: true,
                conflictedUserId: session.user.id,
                reassignedAt: now.toISOString(),
                reassignmentReason: 'Requester-authoriser conflict',
                resolvedRoleId: role.roleId,
                resolvedEmployeeId:
                  typeof actingRow.employee_id === 'string' ? actingRow.employee_id : null,
                resolvedCapacity: 'acting',
                isActing: true,
                delegationId:
                  typeof actingRow.delegation_id === 'string' ? actingRow.delegation_id : null,
              },
              updatedAt: now,
            })
            .where(
              and(
                eq(workflowInstances.id, instance.id),
                eq(workflowInstances.currentStepOrder, currentStep.stepOrder),
                eq(workflowInstances.status, 'active'),
              ),
            )
            .returning({ id: workflowInstances.id });
          if (!reassignedInstance) return null;

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

          const [reassignedInstance] = await this.db
            .update(workflowInstances)
            .set({
              currentAssignedUserId: sameRole.userId,
              currentAssignmentMeta: {
                ...(currentStep.config || {}),
                conflictReassigned: true,
                conflictedUserId: session.user.id,
                reassignedAt: now.toISOString(),
                reassignmentReason: 'Requester-authoriser conflict',
                resolvedRoleId: role.roleId,
                resolvedEmployeeId: sameRole.id,
                resolvedCapacity: 'substantive',
                isActing: false,
                delegationId: null,
              },
              updatedAt: now,
            })
            .where(
              and(
                eq(workflowInstances.id, instance.id),
                eq(workflowInstances.currentStepOrder, currentStep.stepOrder),
                eq(workflowInstances.status, 'active'),
              ),
            )
            .returning({ id: workflowInstances.id });
          if (!reassignedInstance) return null;

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

  private async sendActionNotification(
    instance: typeof workflowInstances.$inferSelect,
    currentStep: { label: string; stepOrder: number },
    result: string,
    _session: AuthSession,
  ) {
    try {
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
        } catch {}
      })();
    } catch (err) {
      console.error('[Workflow] Notification failed:', err);
    }
  }

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
