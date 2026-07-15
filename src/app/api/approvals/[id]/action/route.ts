import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { workflowInstances, workflowSteps, workflowActions } from '@/db/schema/workflows';
import { eq, and } from 'drizzle-orm';
import { getServerSessionFromRequest } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();

    // Get authenticated user session (fall back to body values for dev)
    const session = await getServerSessionFromRequest(request);
    const userId = session?.user?.id || body.userId || 'system';

    const { actionType, comment, isActing } = body;

    if (!actionType || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: actionType, userId' },
        { status: 400 },
      );
    }

    // Get the workflow instance
    const [instance] = await db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, id))
      .limit(1);

    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 });
    }

    if (instance.status !== 'active') {
      return NextResponse.json(
        { error: `Workflow is already ${instance.status}. Only active workflows can receive actions.` },
        { status: 409 },
      );
    }

    // Get the current step definition filtered by currentStepOrder
    const [currentStep] = await db
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.definitionId, instance.definitionId),
          eq(workflowSteps.stepOrder, instance.currentStepOrder),
        ),
      )
      .limit(1);

    if (!currentStep) {
      return NextResponse.json(
        { error: `No workflow step found at order ${instance.currentStepOrder}` },
        { status: 500 },
      );
    }

    // Validate action type
    const validResults = ['approved', 'rejected', 'returned'];
    if (!validResults.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid action type: ${actionType}. Valid: ${validResults.join(', ')}` },
        { status: 400 },
      );
    }

    // Record the action
    const [action] = await db
      .insert(workflowActions)
      .values({
        instanceId: id,
        stepOrder: instance.currentStepOrder,
        actionType: currentStep.actionType,
        result: actionType,
        comment: comment || null,
        isActing: isActing || false,
        actorUserId: userId,
      })
      .returning();

    // Update workflow instance based on action
    if (actionType === 'approved') {
      // Count total steps in this definition
      const allSteps = await db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.definitionId, instance.definitionId));
      const totalSteps = allSteps.length;

      if (instance.currentStepOrder >= totalSteps) {
        // All steps completed
        await db
          .update(workflowInstances)
          .set({ status: 'completed', currentStepOrder: instance.currentStepOrder + 1 })
          .where(eq(workflowInstances.id, id));
      } else {
        // Advance to next step
        await db
          .update(workflowInstances)
          .set({ currentStepOrder: instance.currentStepOrder + 1 })
          .where(eq(workflowInstances.id, id));
      }
    } else if (actionType === 'rejected') {
      await db
        .update(workflowInstances)
        .set({ status: 'cancelled' })
        .where(eq(workflowInstances.id, id));
    } else if (actionType === 'returned') {
      await db
        .update(workflowInstances)
        .set({ currentStepOrder: 1 })
        .where(eq(workflowInstances.id, id));
    }

    return NextResponse.json({
      success: true,
      data: action,
    });
  } catch (error) {
    console.error('Approval action failed:', error);
    return NextResponse.json(
      { error: 'Failed to process approval action: ' + String(error) },
      { status: 500 },
    );
  }
}
