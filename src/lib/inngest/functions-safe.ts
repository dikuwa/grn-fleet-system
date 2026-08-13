import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkflowEngine } from '@/lib/workflow-engine';
import { WorkspaceIds } from '@/lib/workspaces';
import { inngest, Events } from './client';
import * as legacy from './functions';

export * from './functions';

type WorkflowTimerPayload = {
  workflowInstanceId: string;
  stepOrder: number;
};

async function getInstanceWithTenant(workflowInstanceId: string) {
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

async function resolveCurrentStepRecipients(workflowInstanceId: string, tenantId: string) {
  try {
    const engine = new WorkflowEngine({ db: getDb() });
    return await engine.getCurrentStepRecipients(workflowInstanceId, tenantId);
  } catch (error) {
    console.warn('[inngest] Failed to resolve workflow step recipients:', error);
    return [];
  }
}

async function emailUserIds(input: {
  tenantId: string;
  userIds: readonly string[];
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
}) {
  if (!input.userIds.length) return 0;
  const db = getDb();
  const { user } = await import('@/db/schema/better-auth');
  const { notificationPreferences } = await import('@/db/schema/notifications');
  const { inArray } = await import('drizzle-orm');
  const { sendNotificationEmail } = await import('@/lib/email');

  const users = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, [...input.userIds]));
  const prefs = await db
    .select({
      userId: notificationPreferences.userId,
      emailNotifications: notificationPreferences.emailNotifications,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, input.tenantId),
        inArray(notificationPreferences.userId, [...input.userIds]),
      ),
    );
  const prefMap = new Map(prefs.map((pref) => [pref.userId, pref.emailNotifications !== false]));

  let sent = 0;
  for (const recipient of users) {
    if (!recipient.email) continue;
    if (prefMap.has(recipient.id) && !prefMap.get(recipient.id)) continue;
    try {
      const result = await sendNotificationEmail({
        to: recipient.email,
        type: input.type,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        recipientName: recipient.name || 'Approver',
      });
      if (result.success) sent += 1;
    } catch (error) {
      console.warn(`[inngest] Email to ${recipient.email} failed:`, error);
    }
  }
  return sent;
}

async function validateActiveScheduledStep(workflowInstanceId: string, stepOrder: number) {
  const db = getDb();
  const instance = await getInstanceWithTenant(workflowInstanceId);
  if (!instance || instance.status !== 'active') {
    return { ok: false as const, reason: 'Workflow no longer active', instance: null };
  }

  // The timer belongs to the step that scheduled it. A delayed/retried event
  // must never notify the assignee of a later step while describing the stale
  // step number from the original event.
  if (instance.currentStepOrder !== stepOrder) {
    return { ok: false as const, reason: 'Workflow has advanced to a different step', instance };
  }

  const [action] = await db
    .select({ id: workflowActions.id })
    .from(workflowActions)
    .where(
      and(
        eq(workflowActions.instanceId, workflowInstanceId),
        eq(workflowActions.stepOrder, stepOrder),
      ),
    )
    .limit(1);
  if (action) {
    return { ok: false as const, reason: 'Step already completed', instance };
  }

  return { ok: true as const, instance };
}

export const stepReminder = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-reminder', retries: 2 },
      { event: Events.WORKFLOW_REMINDER },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as WorkflowTimerPayload;
        return step.run('Send reminder notification', async () => {
          const guard = await validateActiveScheduledStep(workflowInstanceId, stepOrder);
          if (!guard.ok) return { skipped: true, reason: guard.reason };

          const recipients = await resolveCurrentStepRecipients(
            workflowInstanceId,
            guard.instance.tenantId,
          );
          if (recipients.length === 0) {
            return { skipped: true, reason: 'No resolvable user holds the current step' };
          }

          const [notification] = await createScopedNotifications({
            tenantId: guard.instance.tenantId,
            recipientUserIds: recipients,
            category: 'reminder',
            eventType: 'approval_due_reminder',
            title: 'Workflow Action Reminder',
            body: `Step ${stepOrder} requires attention in workflow ${workflowInstanceId.slice(0, 8)}.`,
            entityType: 'workflow_instance',
            entityId: workflowInstanceId,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(stepOrder),
            priority: 'normal',
          });
          const emailed = await emailUserIds({
            tenantId: guard.instance.tenantId,
            userIds: recipients,
            type: 'reminder',
            title: 'Workflow Action Reminder',
            body: `Step ${stepOrder} requires attention in workflow ${workflowInstanceId.slice(0, 8)}. Please review and take action.`,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
          });
          return {
            sent: Boolean(notification),
            notificationId: notification?.id,
            emailed,
            recipientCount: recipients.length,
          };
        });
      },
    )
  : null;

export const stepEscalation = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-escalation', retries: 2 },
      { event: Events.WORKFLOW_ESCALATION },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as WorkflowTimerPayload;
        return step.run('Send escalation notification', async () => {
          const guard = await validateActiveScheduledStep(workflowInstanceId, stepOrder);
          if (!guard.ok) return { skipped: true, reason: guard.reason };

          const recipients = await resolveCurrentStepRecipients(
            workflowInstanceId,
            guard.instance.tenantId,
          );
          if (recipients.length === 0) {
            return { skipped: true, reason: 'No resolvable user holds the current step' };
          }

          const [notification] = await createScopedNotifications({
            tenantId: guard.instance.tenantId,
            recipientUserIds: recipients,
            category: 'escalation',
            eventType: 'approval_overdue_escalation',
            title: '⚠️ Workflow Escalation',
            body: `Step ${stepOrder} in workflow ${workflowInstanceId.slice(0, 8)} has exceeded its time limit and requires escalation.`,
            entityType: 'workflow_instance',
            entityId: workflowInstanceId,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(stepOrder),
            priority: 'high',
            mandatory: true,
          });
          const emailed = await emailUserIds({
            tenantId: guard.instance.tenantId,
            userIds: recipients,
            type: 'escalation',
            title: '⚠️ Workflow Escalation',
            body: `Step ${stepOrder} in workflow ${workflowInstanceId.slice(0, 8)} has exceeded its time limit. Immediate attention required.`,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
          });
          return {
            sent: Boolean(notification),
            notificationId: notification?.id,
            emailed,
            recipientCount: recipients.length,
          };
        });
      },
    )
  : null;

export const inngestFunctions = [
  stepReminder,
  stepEscalation,
  ...legacy.inngestFunctions.filter(
    (fn) => fn !== legacy.stepReminder && fn !== legacy.stepEscalation,
  ),
].filter((fn): fn is NonNullable<typeof fn> => fn !== null);
