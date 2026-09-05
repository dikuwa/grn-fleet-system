import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { workflowInstances } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import {
  WorkflowEngine,
  type WorkflowActionType,
  type WorkflowActionResult,
} from '@/lib/workflow-engine';
import { processSupervisorDecisionAtomic } from '@/lib/supervisor-approval';
import { processAtomicWorkflowDecision } from '@/lib/workflow-decision-atomic';
import { processAuthorisationDecision } from '@/lib/authorisation-decision';
import { processExternalAuthorisationDecision } from '@/lib/external-authorisation-decision';
import { sendWorkflowOutcomeEmailBestEffort } from '@/lib/workflow-outcome-email';
import { evaluateTripReleaseGate } from '@/lib/trip-release-gate';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function semanticPositiveResult(actionType: string): WorkflowActionResult {
  switch (actionType) {
    case 'release':
      return 'released';
    case 'authorise':
      return 'authorised';
    case 'acknowledge':
      return 'acknowledged';
    default:
      return 'approved';
  }
}

function isExpectedAtomicRollback(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === '22P02' && String(candidate.message || '').includes('atomic_');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/approvals', 'approve');
    if (roleCheck instanceof NextResponse) {
      const driverCheck = await requireDashboardAction(
        session,
        '/dashboard/driver-mobile',
        'update',
      );
      if (driverCheck instanceof NextResponse) return roleCheck;
    }

    const body = await request.json();
    const { actionType, comment, financeEvidence } = body;
    const validDecisions = ['approved', 'rejected', 'returned'];
    if (!validDecisions.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid decision: ${actionType}. Valid: ${validDecisions.join(', ')}` },
        { status: 400 },
      );
    }
    if ((!comment || !String(comment).trim()) && ['returned', 'rejected'].includes(actionType)) {
      return NextResponse.json(
        {
          error:
            actionType === 'returned'
              ? 'A reason is required when returning a request for correction.'
              : 'A reason is required when rejecting a request.',
        },
        { status: 400 },
      );
    }
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 });
    }

    const db = getDb();
    const [instance] = await db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, id))
      .limit(1);
    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 });
    }

    const [requestOwner] = await db
      .select({ tenantId: transportRequests.tenantId })
      .from(transportRequests)
      .where(eq(transportRequests.id, instance.requestId))
      .limit(1);
    if (!requestOwner || requestOwner.tenantId !== session.tenantId) {
      return NextResponse.json(
        { error: 'Workflow instance not found or access denied' },
        { status: 404 },
      );
    }

    const engine = new WorkflowEngine({ db });
    const status = await engine.getWorkflowStatus(id);
    if (!status?.currentStep?.actionType) {
      return NextResponse.json(
        { error: 'Could not determine the current workflow step. The action cannot be processed.' },
        { status: 400 },
      );
    }

    const stepActionType = status.currentStep.actionType;
    if (stepActionType === 'acknowledge') {
      return NextResponse.json(
        {
          error:
            'Driver acknowledgement must be completed from the assigned trip in Driver Console so the vehicle, route, passenger manifest and driver licence can be verified.',
          actionUrl: '/dashboard/trips',
        },
        { status: 409 },
      );
    }
    if (
      stepActionType === 'transport_review' &&
      actionType === 'approved' &&
      String(comment || '').trim().length < 3
    ) {
      return NextResponse.json(
        {
          error:
            'An operational release note is required before Transport Review can advance. Record the assignment, schedule checks, corrections made, and any instruction for the next stage.',
        },
        { status: 422 },
      );
    }
    let decisionMetadata: Record<string, unknown> | undefined;
    if (stepActionType === 'finance_review' && actionType === 'approved') {
      const outcome = String(financeEvidence?.outcome || '');
      const budgetReference = String(financeEvidence?.budgetReference || '').trim();
      const allowedOutcomes = ['budget_available', 'funding_approved_with_conditions', 'no_commitment_required'];
      const approvedAmount =
        financeEvidence?.approvedAmount == null || financeEvidence.approvedAmount === ''
          ? null
          : Number(financeEvidence.approvedAmount);
      if (!allowedOutcomes.includes(outcome) || budgetReference.length < 3) {
        return NextResponse.json(
          { error: 'Choose a Finance/Budget outcome and provide its governing budget reference.' },
          { status: 422 },
        );
      }
      if (approvedAmount != null && (!Number.isFinite(approvedAmount) || approvedAmount < 0)) {
        return NextResponse.json({ error: 'Approved amount must be a valid NAD amount.' }, { status: 422 });
      }
      decisionMetadata = {
        financeEvidence: {
          outcome,
          budgetReference: budgetReference.slice(0, 120),
          approvedAmount: approvedAmount == null ? null : approvedAmount.toFixed(2),
          currency: 'NAD',
        },
      };
    }

    if (stepActionType === 'transport_review' && actionType === 'approved') {
      const readinessGate = await evaluateTripReleaseGate({
        tenantId: session.tenantId,
        requestId: instance.requestId,
        stage: 'release',
      });
      if (!readinessGate.allowed) {
        return NextResponse.json(
          {
            error: 'Transport Review is blocked by live operational readiness requirements.',
            blockers: readinessGate.blockers,
            checks: readinessGate.checks,
            driverKind: readinessGate.driverKind,
            actionUrl: readinessGate.tripId
              ? `/dashboard/trips/${readinessGate.tripId}`
              : `/dashboard/approvals/${id}/action`,
          },
          { status: 409 },
        );
      }
    }

    if (stepActionType === 'release' && actionType === 'approved') {
      const releaseGate = await evaluateTripReleaseGate({
        tenantId: session.tenantId,
        requestId: instance.requestId,
        stage: 'release',
      });
      if (!releaseGate.allowed) {
        return NextResponse.json(
          {
            error: 'Release is blocked by operational readiness requirements.',
            blockers: releaseGate.blockers,
            checks: releaseGate.checks,
            driverKind: releaseGate.driverKind,
            actionUrl: releaseGate.tripId
              ? `/dashboard/trips/${releaseGate.tripId}`
              : `/dashboard/approvals/${id}/action`,
          },
          { status: 409 },
        );
      }
    }

    let authorisationDriverKind: 'internal' | 'external' | null = null;
    if (stepActionType === 'authorise' && actionType === 'approved') {
      const releaseGate = await evaluateTripReleaseGate({
        tenantId: session.tenantId,
        requestId: instance.requestId,
        stage: 'authorisation',
      });
      if (!releaseGate.allowed) {
        return NextResponse.json(
          {
            error: 'Final authorisation is blocked by operational release requirements.',
            blockers: releaseGate.blockers,
            checks: releaseGate.checks,
            driverKind: releaseGate.driverKind,
            actionUrl: releaseGate.tripId
              ? `/dashboard/trips/${releaseGate.tripId}`
              : `/dashboard/approvals/${id}/action`,
          },
          { status: 409 },
        );
      }
      if (releaseGate.driverKind === 'internal' || releaseGate.driverKind === 'external') {
        authorisationDriverKind = releaseGate.driverKind;
      }
    }

    const semanticResult: WorkflowActionResult =
      actionType === 'approved'
        ? semanticPositiveResult(stepActionType)
        : (actionType as WorkflowActionResult);

    let result;
    if (stepActionType === 'supervisor_approve') {
      result = await processSupervisorDecisionAtomic({
        instanceId: id,
        result: semanticResult,
        comment: typeof comment === 'string' ? comment : undefined,
        session,
      });
    } else if (
      stepActionType === 'organisational_approve' ||
      stepActionType === 'finance_review' ||
      stepActionType === 'transport_review' ||
      stepActionType === 'release'
    ) {
      result = await processAtomicWorkflowDecision({
        instanceId: id,
        action: stepActionType as WorkflowActionType,
        result: semanticResult,
        comment: typeof comment === 'string' ? comment : undefined,
        metadata: decisionMetadata,
        session,
      });
    } else if (
      stepActionType === 'authorise' &&
      semanticResult === 'authorised' &&
      authorisationDriverKind === 'external'
    ) {
      result = await processExternalAuthorisationDecision({
        instanceId: id,
        comment: typeof comment === 'string' ? comment : undefined,
        session,
      });
    } else if (stepActionType === 'authorise') {
      result = await processAuthorisationDecision({
        instanceId: id,
        result: semanticResult,
        comment: typeof comment === 'string' ? comment : undefined,
        session,
      });
    } else {
      return NextResponse.json(
        { error: `Unsupported workflow action: ${stepActionType}` },
        { status: 400 },
      );
    }

    if (!result.ok) return result.error;

    await sendWorkflowOutcomeEmailBestEffort({
      requestId: instance.requestId,
      result: semanticResult,
      stepLabel: status.currentStep.label,
      comment: typeof comment === 'string' ? comment : undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        message: result.message,
        instance: result.instance,
      },
    });
  } catch (error) {
    if (isExpectedAtomicRollback(error)) {
      console.warn('Approval action rolled back because the workflow changed concurrently:', error);
      return NextResponse.json(
        { error: 'This workflow changed while the decision was being recorded. Refresh and try again.' },
        { status: 409 },
      );
    }
    console.error('Approval action failed:', error);
    return NextResponse.json({ error: 'Failed to process approval action' }, { status: 500 });
  }
}
