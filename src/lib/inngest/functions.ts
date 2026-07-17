/**
 * Inngest — Background Job Functions
 *
 * Defines the handlers for scheduled background jobs:
 *   - workflow/step-reminder:   Remind the assigned approver that action is needed
 *   - workflow/step-escalation:  Escalate an overdue step to a higher authority
 *   - workflow/approval-completed: Send notifications on approval completion
 *
 * These functions are registered with Inngest and run on the Inngest server
 * (or via the dev server during development).
 */

import { inngest, Events } from './client';
import { getDb } from '@/db';
import { workflowInstances, workflowSteps, workflowActions } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { notifications } from '@/db/schema/notifications';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type EventPayloads = {
  [Events.WORKFLOW_REMINDER]: { workflowInstanceId: string; stepOrder: number };
  [Events.WORKFLOW_ESCALATION]: { workflowInstanceId: string; stepOrder: number };
  [Events.APPROVAL_COMPLETED]: { workflowInstanceId: string; result: string; actorUserId: string };
};

// ---------------------------------------------------------------------------
// Helper: get instance info with tenantId
// ---------------------------------------------------------------------------

async function getInstanceWithTenant(
  workflowInstanceId: string,
): Promise<{ status: string; requestId: string; tenantId: string; currentStepOrder: number } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      status: workflowInstances.status,
      requestId: workflowInstances.requestId,
      currentStepOrder: workflowInstances.currentStepOrder,
      tenantId: transportRequests.tenantId,
    })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .where(eq(workflowInstances.id, workflowInstanceId))
    .limit(1);

  return row || null;
}

// ---------------------------------------------------------------------------
// Step Reminder
// ---------------------------------------------------------------------------

export const stepReminder = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-reminder', retries: 2 },
      { event: Events.WORKFLOW_REMINDER },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as EventPayloads[typeof Events.WORKFLOW_REMINDER];

        return step.run('Send reminder notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance || instance.status !== 'active') {
            return { skipped: true, reason: 'Workflow no longer active' };
          }

          const [action] = await db
            .select()
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflowInstanceId),
                eq(workflowActions.stepOrder, stepOrder),
              ),
            )
            .limit(1);

          if (action) {
            return { skipped: true, reason: 'Step already completed' };
          }

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: instance.requestId,
              type: 'reminder',
              title: 'Workflow Action Reminder',
              body: `Step ${stepOrder} requires attention in workflow ${workflowInstanceId.slice(0, 8)}.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'normal',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Step Escalation
// ---------------------------------------------------------------------------

export const stepEscalation = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-escalation', retries: 2 },
      { event: Events.WORKFLOW_ESCALATION },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as EventPayloads[typeof Events.WORKFLOW_ESCALATION];

        return step.run('Send escalation notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance || instance.status !== 'active') {
            return { skipped: true, reason: 'Workflow no longer active' };
          }

          const [action] = await db
            .select()
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflowInstanceId),
                eq(workflowActions.stepOrder, stepOrder),
              ),
            )
            .limit(1);

          if (action) {
            return { skipped: true, reason: 'Step already completed' };
          }

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: instance.requestId,
              type: 'escalation',
              title: '⚠️ Workflow Escalation',
              body: `Step ${stepOrder} in workflow ${workflowInstanceId.slice(0, 8)} has exceeded its time limit and requires escalation.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'high',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Approval Completed Notification
// ---------------------------------------------------------------------------

export const approvalCompleted = inngest
  ? inngest.createFunction(
      { id: 'workflow-approval-completed', retries: 1 },
      { event: Events.APPROVAL_COMPLETED },
      async ({ event, step }) => {
        const { workflowInstanceId, result, actorUserId } = event.data as EventPayloads[typeof Events.APPROVAL_COMPLETED];

        return step.run('Send approval notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance) {
            return { skipped: true, reason: 'Workflow instance not found' };
          }

          const title =
            result === 'approved'
              ? '✅ Request Approved'
              : result === 'rejected'
                ? '❌ Request Rejected'
                : '↩️ Request Returned';

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: actorUserId,
              type: 'outcome',
              title,
              body: `Workflow ${workflowInstanceId.slice(0, 8)}: ${result} by user ${actorUserId}.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'normal',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register all functions
// ---------------------------------------------------------------------------

/** Array of all registered Inngest functions (with nulls filtered out) */
export const inngestFunctions = [
  stepReminder,
  stepEscalation,
  approvalCompleted,
].filter(Boolean);
