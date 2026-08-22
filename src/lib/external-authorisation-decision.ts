import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import type { AuthSession } from '@/lib/auth-helpers';
import { forbiddenResponse, requirePermission } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { WorkflowEngine, type EngineResult } from '@/lib/workflow-engine';
import { workflowCompletedStatus } from '@/lib/request-status';
import { provisionExternalTripAuthority } from '@/lib/external-trip-authority';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

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
 * Final authorisation for an accepted external driver.
 *
 * The normal internal-driver path remains in `authorisation-decision.ts` and
 * ends at Driver Acknowledgement. External people do not receive employee/user
 * accounts, so their staff-recorded accepted assignment is converted into the
 * acknowledgement evidence for that final workflow step. The external party,
 * verified licence, acceptance method and recorder are retained in immutable
 * authority/workflow/audit snapshots instead of fabricating an employee.
 */
export async function processExternalAuthorisationDecision(input: {
  instanceId: string;
  comment?: string;
  session: AuthSession;
}): Promise<EngineResult> {
  const { instanceId, comment, session } = input;
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
        requesterUserId: transportRequests.requesterUserId,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        travellerEmployeeId: transportRequests.travellerEmployeeId,
        reference: transportRequests.reference,
        status: transportRequests.status,
        vehicleRequirements: transportRequests.vehicleRequirements,
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

  const nextStep = status.definition.steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
  if (!nextStep || nextStep.actionType !== 'acknowledge') {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Final authorisation is not followed by a valid driver-acknowledgement stage.' }, { status: 409 }),
    };
  }

  const [assignment] = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationVersion: vehicleAllocations.version,
      allocationEndAt: vehicleAllocations.endAt,
      tripId: trips.id,
      vehicleId: vehicleAllocations.vehicleId,
      vehicleStatus: vehicles.status,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      internalDriverEmployeeId: vehicleAllocations.driverEmployeeId,
      externalAssignmentId: externalDriverAssignments.id,
      externalPartyId: externalDriverAssignments.externalPartyId,
      licenceId: externalDriverAssignments.licenceId,
      acceptedAt: externalDriverAssignments.acceptedAt,
      acceptanceMethod: externalDriverAssignments.acceptanceMethod,
      acceptanceNote: externalDriverAssignments.acceptanceNote,
      acceptedRecordedByUserId: externalDriverAssignments.acceptedRecordedByUserId,
      assignedByUserId: externalDriverAssignments.assignedByUserId,
      partyStatus: externalParties.status,
      partyFirstName: externalParties.firstName,
      partyLastName: externalParties.lastName,
      licenceClass: externalDriverLicences.licenceClass,
      licenceExpiry: externalDriverLicences.expiryDate,
      licenceVerificationStatus: externalDriverLicences.verificationStatus,
    })
    .from(vehicleAllocations)
    .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, vehicleAllocations.vehicleId), eq(vehicles.tenantId, session.tenantId)),
    )
    .innerJoin(
      externalDriverAssignments,
      and(
        eq(externalDriverAssignments.allocationId, vehicleAllocations.id),
        eq(externalDriverAssignments.tripId, trips.id),
        eq(externalDriverAssignments.requestId, vehicleAllocations.requestId),
        eq(externalDriverAssignments.tenantId, session.tenantId),
        eq(externalDriverAssignments.state, 'accepted'),
      ),
    )
    .innerJoin(
      externalParties,
      and(
        eq(externalParties.id, externalDriverAssignments.externalPartyId),
        eq(externalParties.tenantId, session.tenantId),
      ),
    )
    .innerJoin(
      externalDriverLicences,
      and(
        eq(externalDriverLicences.id, externalDriverAssignments.licenceId),
        eq(externalDriverLicences.externalPartyId, externalDriverAssignments.externalPartyId),
        eq(externalDriverLicences.tenantId, session.tenantId),
      ),
    )
    .where(
      and(
        eq(vehicleAllocations.requestId, instance.requestId),
        eq(vehicleAllocations.state, 'confirmed'),
        eq(trips.tenantId, session.tenantId),
        eq(trips.status, 'pending'),
      ),
    )
    .orderBy(desc(vehicleAllocations.updatedAt), desc(externalDriverAssignments.updatedAt))
    .limit(1);
  if (
    !assignment ||
    assignment.internalDriverEmployeeId ||
    assignment.partyStatus !== 'active' ||
    assignment.licenceVerificationStatus !== 'verified' ||
    !assignment.acceptedAt
  ) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'A current accepted external driver with a verified licence is required before final authorisation.' },
        { status: 409 },
      ),
    };
  }
  if (new Date(`${assignment.licenceExpiry}T23:59:59.999Z`) < assignment.allocationEndAt) {
    return { ok: false, error: NextResponse.json({ error: 'The external driver licence does not remain valid for the full trip period.' }, { status: 409 }) };
  }
  if (
    assignment.requiredLicenceClass &&
    !namibiaLicenceClassCovers(assignment.licenceClass, assignment.requiredLicenceClass)
  ) {
    return { ok: false, error: NextResponse.json({ error: 'The external driver licence class does not cover the currently assigned vehicle.' }, { status: 409 }) };
  }
  if (assignment.professionalAuthorisationRequired) {
    return { ok: false, error: NextResponse.json({ error: 'The assigned vehicle requires professional driving authorisation and cannot use this external driver.' }, { status: 409 }) };
  }

  const resolution = (currentStep.config || {}) as Record<string, unknown>;
  const roleAssignmentId = typeof resolution.delegationId === 'string' ? resolution.delegationId : null;
  const isActing = resolution.isActing === true;
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
          driverKind: 'external',
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

  const stagedRequirements = (requestRecord.vehicleRequirements || {}) as Record<string, unknown>;
  const stagedPhysicalAuthorityNumber =
    typeof stagedRequirements.physicalTripAuthorityNumber === 'string' && stagedRequirements.physicalTripAuthorityNumber.trim()
      ? stagedRequirements.physicalTripAuthorityNumber.trim()
      : null;

  await provisionExternalTripAuthority({
    tripId: assignment.tripId,
    tenantId: session.tenantId,
    requestId: instance.requestId,
    allocationId: assignment.allocationId,
    actorUserId: session.user.id,
    manualAuthorityNumber: stagedPhysicalAuthorityNumber,
  });

  const acknowledgementRecorder = assignment.acceptedRecordedByUserId || assignment.assignedByUserId;
  const acceptanceMetadata = JSON.stringify({
    source: 'external_driver_assignment',
    externalAssignmentId: assignment.externalAssignmentId,
    externalPartyId: assignment.externalPartyId,
    licenceId: assignment.licenceId,
    acceptedAt: assignment.acceptedAt.toISOString(),
    acceptanceMethod: assignment.acceptanceMethod,
    acceptanceNote: assignment.acceptanceNote,
    acceptedDriverName: `${assignment.partyFirstName} ${assignment.partyLastName}`.trim(),
    acceptedRecordedByUserId: acknowledgementRecorder,
  });
  const completedStatus = workflowCompletedStatus();
  const auditAuthorisationId = randomUUID();
  const auditAcceptanceId = randomUUID();
  const acknowledgementActionId = randomUUID();
  const now = new Date();
  let commit;
  try {
    commit = await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1, updated_at = ${now}
        WHERE va.id = ${assignment.allocationId}::uuid
          AND va.request_id = ${instance.requestId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${assignment.allocationVersion}
          AND va.driver_employee_id IS NULL
          AND EXISTS (
            SELECT 1 FROM trips t
            WHERE t.id = ${assignment.tripId}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND t.allocation_id = va.id
              AND t.status = 'pending'
              AND t.issued_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM external_driver_assignments eda
            WHERE eda.id = ${assignment.externalAssignmentId}::uuid
              AND eda.tenant_id = ${session.tenantId}::uuid
              AND eda.allocation_id = va.id
              AND eda.trip_id = ${assignment.tripId}::uuid
              AND eda.external_party_id = ${assignment.externalPartyId}::uuid
              AND eda.licence_id = ${assignment.licenceId}::uuid
              AND eda.state = 'accepted'
              AND eda.accepted_at IS NOT NULL
          )
        RETURNING va.id
      ),
      claimed AS (
        UPDATE workflow_instances wi
        SET status = 'completed', current_step_order = ${nextStep.stepOrder}, updated_at = ${now}
        WHERE wi.id = ${instanceId}::uuid
          AND wi.status = 'active'
          AND wi.current_step_order = ${currentStep.stepOrder}
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1 FROM workflow_actions wa
            WHERE wa.instance_id = wi.id
              AND wa.step_order = ${currentStep.stepOrder}
              AND wa.action_type = 'authorise'
              AND wa.result = 'authorised'
              AND wa.actor_user_id = ${session.user.id}
          )
          AND NOT EXISTS (
            SELECT 1 FROM workflow_actions wa
            WHERE wa.instance_id = wi.id AND wa.step_order = ${nextStep.stepOrder}
          )
        RETURNING wi.id, wi.request_id
      ),
      request_updated AS (
        UPDATE transport_requests tr
        SET status = ${completedStatus}, updated_at = ${now}
        FROM claimed c
        WHERE tr.id = c.request_id
          AND tr.tenant_id = ${session.tenantId}::uuid
          AND tr.status = ${requestRecord.status}
          AND tr.assigned_driver_employee_id IS NULL
        RETURNING tr.id
      ),
      acknowledgement_inserted AS (
        INSERT INTO workflow_actions (
          id, instance_id, step_order, action_type, result,
          actor_user_id, actor_employee_id, is_acting, comment, metadata, created_at
        )
        SELECT
          ${acknowledgementActionId}::uuid, c.id, ${nextStep.stepOrder}, 'acknowledge', 'acknowledged',
          ${acknowledgementRecorder}, NULL, false, ${assignment.acceptanceNote},
          ${acceptanceMetadata}::jsonb, ${now}
        FROM claimed c
        INNER JOIN request_updated ru ON ru.id = c.request_id
        RETURNING id
      ),
      authorisation_audit AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          actor_employee_id, role_assignment_id, is_acting, action,
          entity_type, entity_id, source_channel, summary, reason, created_at
        )
        SELECT
          ${auditAuthorisationId}::uuid, ${session.tenantId}::uuid, ${Date.now()}, 'workflow_authorised',
          ${session.user.id}, ${actorEmployee?.id ?? null}::uuid, ${roleAssignmentId}::uuid,
          ${isActing}, 'workflow.authorised', 'workflow_action', ${instanceId}::uuid, 'web',
          'Final trip authorisation completed for external driver', ${comment?.trim() || null}, ${now}
        FROM acknowledgement_inserted
        RETURNING id
      ),
      acceptance_audit AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, source_channel, summary, reason, after, created_at
        )
        SELECT
          ${auditAcceptanceId}::uuid, ${session.tenantId}::uuid, ${Date.now() + 1}, 'workflow_external_driver_acknowledged',
          ${acknowledgementRecorder}, 'workflow.acknowledged', 'workflow_action', ${instanceId}::uuid,
          'recorded_external_acceptance', 'Accepted external driver evidence linked to authorised trip',
          ${assignment.acceptanceNote}, ${acceptanceMetadata}::jsonb, ${now}
        FROM authorisation_audit
        RETURNING id
      )
      SELECT CAST(
        CASE
          WHEN (SELECT count(*) FROM allocation_claim) = 1
           AND (SELECT count(*) FROM claimed) = 1
           AND (SELECT count(*) FROM request_updated) = 1
           AND (SELECT count(*) FROM acknowledgement_inserted) = 1
           AND (SELECT count(*) FROM acceptance_audit) = 1
          THEN '1' ELSE 'atomic_external_authorisation_failed'
        END AS integer
      ) AS committed
    `);
  } catch (error) {
    console.warn('[external-authorisation] Atomic completion rolled back:', error);
    const latest = await reloadInstance(instanceId).catch(() => null);
    if (latest?.status === 'completed') {
      return { ok: true, message: 'External-driver final authorisation was already completed.', instance: latest };
    }
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'The external-driver assignment changed while final authorisation was being completed. Refresh and review the current assignment.' },
        { status: 409 },
      ),
    };
  }

  const committed = Number((commit.rows?.[0] as { committed?: number | string } | undefined)?.committed ?? 0);
  if (committed !== 1) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'The external-driver assignment changed while final authorisation was being completed. Refresh and review the current assignment.' },
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
  await recordTenantRequestActivity({
    tenantId: session.tenantId,
    requestId: instance.requestId,
    reference: requestRecord.reference,
    stage: 'acknowledged',
    officeLabel: 'External driver acceptance',
  }).catch(() => undefined);

  if (requestRecord.requesterUserId) {
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: [requestRecord.requesterUserId],
      category: 'outcome',
      eventType: 'request_authorised',
      title: 'Trip authorised',
      body: `Transport request ${requestRecord.reference} has received final authorisation. The accepted external-driver assignment is recorded and the trip is ready for departure inspection.`,
      entityType: 'workflow_instance',
      entityId: instanceId,
      actionUrl: `/dashboard/requests/${instance.requestId}`,
      workspace: WorkspaceIds.PERSONAL,
      workflowStage: String(currentStep.stepOrder),
      priority: 'normal',
    }).catch(() => undefined);
  }

  const inspectionRecipients = await resolveActiveRoleRecipients(session.tenantId, [
    SystemRoles.INSPECTOR,
    SystemRoles.RELEASE_OFFICER,
  ]).catch(() => []);
  if (inspectionRecipients.length) {
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: inspectionRecipients,
      category: 'action_required',
      eventType: 'departure_inspection_required',
      title: 'Departure inspection required',
      body: `External driver acceptance is recorded for ${requestRecord.reference}. Complete the official departure inspection before physical vehicle issue.`,
      entityType: 'trip',
      entityId: assignment.tripId,
      actionUrl: `/dashboard/inspections/new?type=departure&tripId=${assignment.tripId}&vehicleId=${assignment.vehicleId}`,
      workspace: null,
      priority: 'high',
    }).catch(() => undefined);
  }

  const updated = await reloadInstance(instanceId);
  if (!updated) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow could not be reloaded after final authorisation.' }, { status: 500 }) };
  }
  return {
    ok: true,
    message: `${currentStep.label} completed. External driver acceptance recorded; departure inspection is next.`,
    instance: updated,
  };
}
