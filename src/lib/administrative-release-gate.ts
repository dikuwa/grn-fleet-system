import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
import {
  evaluateTripReleaseGate,
  type TripReleaseBlocker,
  type TripReleaseGateResult,
  type TripReleaseGateStage,
} from '@/lib/trip-release-gate';

const successfulWorkflowResults = new Set([
  'approved',
  'released',
  'authorised',
  'acknowledged',
  'overridden',
]);

export interface AdministrativeReleaseGateResult
  extends Omit<TripReleaseGateResult, 'stage'> {
  stage: 'release';
}

/**
 * Canonical readiness gate for the optional Administrative Release workflow
 * stage. The underlying trip gate's stage-neutral checks remain the source of
 * truth for allocation, schedule, vehicle, driver/licence and blocking-defect
 * safety. Release then adds only its configured workflow prerequisites.
 *
 * This deliberately does not run `issue` checks (final authority document,
 * driver acknowledgement or departure inspection) because those belong after
 * final authorisation. It also does not run the `authorisation` workflow block,
 * because the release step itself would still be pending at that point.
 */
export async function evaluateAdministrativeReleaseGate(input: {
  tenantId: string;
  requestId: string;
}): Promise<AdministrativeReleaseGateResult> {
  // The canonical gate currently exposes authorisation/issue as its public
  // stages, while all operational safety checks before those stage-specific
  // branches are stage-neutral. Passing the release runtime value here reuses
  // that single safety implementation without importing later-stage checks.
  const operational = await evaluateTripReleaseGate({
    tenantId: input.tenantId,
    requestId: input.requestId,
    stage: 'release' as TripReleaseGateStage,
  });

  const blockers: TripReleaseBlocker[] = [...operational.blockers];
  const checks = { ...operational.checks };
  const db = getDb();

  const [request] = await db
    .select({ workflowInstanceId: transportRequests.workflowInstanceId })
    .from(transportRequests)
    .where(
      and(
        eq(transportRequests.id, input.requestId),
        eq(transportRequests.tenantId, input.tenantId),
      ),
    )
    .limit(1);

  if (!request?.workflowInstanceId) {
    checks.workflowPrerequisitesComplete = false;
    checks.transportReviewComplete = false;
    blockers.push({
      code: 'workflow_not_ready',
      message: 'A submitted approval workflow is required before Administrative Release.',
    });
    blockers.push({
      code: 'transport_review_incomplete',
      message: 'Transport Review must be completed before Administrative Release.',
    });
  } else {
    const [[workflow], steps, actions] = await Promise.all([
      db
        .select({ id: workflowInstances.id, status: workflowInstances.status })
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.id, request.workflowInstanceId),
            eq(workflowInstances.requestId, input.requestId),
          ),
        )
        .limit(1),
      db
        .select()
        .from(workflowSteps)
        .innerJoin(workflowInstances, eq(workflowInstances.definitionId, workflowSteps.definitionId))
        .where(eq(workflowInstances.id, request.workflowInstanceId))
        .orderBy(workflowSteps.stepOrder),
      db
        .select()
        .from(workflowActions)
        .where(eq(workflowActions.instanceId, request.workflowInstanceId)),
    ]);

    const resolvedSteps = steps.map((row) => row.workflow_steps);
    const releaseStep = resolvedSteps.find((step) => step.actionType === 'release');
    const priorSteps = releaseStep
      ? resolvedSteps.filter((step) => step.stepOrder < releaseStep.stepOrder)
      : [];
    const completedStepOrders = new Set(
      actions
        .filter((action) => successfulWorkflowResults.has(action.result))
        .map((action) => action.stepOrder),
    );
    const workflowReady = Boolean(
      workflow &&
        workflow.status === 'active' &&
        releaseStep &&
        priorSteps.every((step) => completedStepOrders.has(step.stepOrder)),
    );
    checks.workflowPrerequisitesComplete = workflowReady;
    if (!workflowReady) {
      blockers.push({
        code: 'workflow_not_ready',
        message: 'All configured workflow stages before Administrative Release must be completed.',
      });
    }

    const transportReview = priorSteps.find((step) => step.actionType === 'transport_review');
    const transportReviewComplete = Boolean(
      transportReview && completedStepOrders.has(transportReview.stepOrder),
    );
    checks.transportReviewComplete = transportReviewComplete;
    if (!transportReviewComplete) {
      blockers.push({
        code: 'transport_review_incomplete',
        message: 'Transport Review must be completed before Administrative Release.',
      });
    }
  }

  return {
    ...operational,
    stage: 'release',
    allowed: operational.allowed && blockers.length === 0,
    blockers,
    checks,
  };
}
