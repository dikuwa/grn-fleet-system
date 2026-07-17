import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { workflowInstances } from '@/db/schema/workflows';
import { eq } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { WorkflowEngine, type WorkflowActionType, type WorkflowActionResult } from '@/lib/workflow-engine';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Require auth
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const body = await request.json();
    const { actionType, comment } = body;

    // actionType here is the desired result (approved, rejected, returned)
    const validResults = ['approved', 'rejected', 'returned'];
    if (!validResults.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid action type: ${actionType}. Valid: ${validResults.join(', ')}` },
        { status: 400 },
      );
    }

    if (!comment && actionType === 'returned') {
      return NextResponse.json(
        { error: 'A comment is required when returning a request.' },
        { status: 400 },
      );
    }

    // Look up the workflow instance to get definition ID and current step
    const db = getDb();
    const [instance] = await db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, id))
      .limit(1);

    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 });
    }

    // Determine the current step's expected action type via the engine.
    // The engine's getWorkflowStatus handles both DB-defined and ad-hoc
    // (built-in) steps through a single code path, so no duplication needed.
    const engine = new WorkflowEngine({ db });
    const status = await engine.getWorkflowStatus(id);

    if (!status || !status.currentStep) {
      return NextResponse.json(
        { error: 'Could not determine the current workflow step. The action cannot be processed.' },
        { status: 400 },
      );
    }

    const stepActionType = status.currentStep.actionType;

    if (!stepActionType) {
      return NextResponse.json(
        { error: 'Could not determine the current workflow step. The action cannot be processed.' },
        { status: 400 },
      );
    }

    // Use the same engine instance to fully process this action
    const result = await engine.processAction(
      {
        instanceId: id,
        action: stepActionType as WorkflowActionType,
        result: actionType as WorkflowActionResult,
        comment: typeof comment === 'string' ? comment : undefined,
        actorUserId: session.user.id,
      },
      session,
    );

    if (!result.ok) return result.error;

    return NextResponse.json({
      success: true,
      data: {
        message: result.message,
        instance: result.instance,
      },
    });
  } catch (error) {
    console.error('Approval action failed:', error);
    return NextResponse.json(
      { error: 'Failed to process approval action: ' + String(error) },
      { status: 500 },
    );
  }
}
