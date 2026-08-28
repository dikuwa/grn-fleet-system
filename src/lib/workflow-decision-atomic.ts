import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { WorkflowEngine, type EngineResult } from '@/lib/workflow-engine';
import { forbiddenResponse, requirePermission } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { evaluateAdministrativeReleaseGate } from '@/lib/administrative-release-gate';
import { processAtomicWorkflowDecision as processAtomicWorkflowDecisionCore } from './workflow-decision-atomic-core';

/**
 * Adds the operational readiness boundary required by a positive Administrative
 * Release decision while preserving the existing race-safe atomic transition
 * implementation unchanged underneath.
 */
export async function processAtomicWorkflowDecision(
  input: Parameters<typeof processAtomicWorkflowDecisionCore>[0],
): Promise<EngineResult> {
  if (input.action !== 'release' || input.result !== 'released') {
    return processAtomicWorkflowDecisionCore(input);
  }

  const db = getDb();
  const engine = new WorkflowEngine({ db });
  const status = await engine.getWorkflowStatus(input.instanceId);
  if (
    !status?.currentStep ||
    status.instance.status !== 'active' ||
    status.currentStep.actionType !== 'release'
  ) {
    return processAtomicWorkflowDecisionCore(input);
  }

  const { currentStep, instance } = status;
  if (currentStep.requiredPermission) {
    const permission = await requirePermission(
      input.session,
      currentStep.requiredPermission as PermissionCode,
    );
    if (permission instanceof NextResponse) return { ok: false, error: permission };
  }
  if (currentStep.assignedUserId && currentStep.assignedUserId !== input.session.user.id) {
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
      requesterType: transportRequests.requesterType,
      requesterEmployeeId: transportRequests.requesterEmployeeId,
      travellerEmployeeId: transportRequests.travellerEmployeeId,
    })
    .from(transportRequests)
    .where(
      and(
        eq(transportRequests.id, instance.requestId),
        eq(transportRequests.tenantId, input.session.tenantId),
      ),
    )
    .limit(1);
  if (!requestRecord) {
    return processAtomicWorkflowDecisionCore(input);
  }

  const [actorEmployee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.userId, input.session.user.id),
        eq(employees.tenantId, input.session.tenantId),
      ),
    )
    .limit(1);
  const selfConflict =
    requestRecord.requesterUserId === input.session.user.id ||
    Boolean(
      actorEmployee &&
        ((requestRecord.requesterType !== 'external' &&
          requestRecord.requesterEmployeeId === actorEmployee.id) ||
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

  const releaseGate = await evaluateAdministrativeReleaseGate({
    tenantId: input.session.tenantId,
    requestId: requestRecord.id,
  });
  if (!releaseGate.allowed) {
    return {
      ok: false,
      error: NextResponse.json(
        {
          error: 'Administrative Release is blocked by operational readiness requirements.',
          blockers: releaseGate.blockers,
          checks: releaseGate.checks,
          driverKind: releaseGate.driverKind,
          actionUrl: releaseGate.tripId
            ? `/dashboard/trips/${releaseGate.tripId}`
            : `/dashboard/approvals/${input.instanceId}/action`,
        },
        { status: 409 },
      ),
    };
  }

  return processAtomicWorkflowDecisionCore(input);
}
