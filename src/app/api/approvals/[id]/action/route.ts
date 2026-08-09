import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
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
import { processDriverAcknowledgement } from '@/lib/driver-acknowledgement';
import { sendWorkflowOutcomeEmailBestEffort } from '@/lib/workflow-outcome-email';

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
    const { actionType, comment } = body;
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
    } else if (stepActionType === 'transport_review' || stepActionType === 'release') {
      result = await processAtomicWorkflowDecision({
        instanceId: id,
        action: stepActionType as WorkflowActionType,
        result: semanticResult,
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
    } else if (stepActionType === 'acknowledge') {
      result = await processDriverAcknowledgement({
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

    // Outbound email is deliberately post-commit and best-effort. It must not
    // make an already durable workflow action appear to have failed.
    void sendWorkflowOutcomeEmailBestEffort({
      requestId: instance.requestId,
      result: semanticResult,
      stepLabel: status.currentStep.label,
    });

    return NextResponse.json({
      success: true,
      data: {
        message: result.message,
        instance: result.instance,
      },
    });
  } catch (error) {
    console.error('Approval action failed:', error);
    return NextResponse.json({ error: 'Failed to process approval action' }, { status: 500 });
  }
}
