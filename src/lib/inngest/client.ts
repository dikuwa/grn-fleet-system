/**
 * Inngest — Background Job Client
 *
 * Provides the Inngest client and helper functions for scheduling
 * workflow reminders, escalations, and other background tasks.
 *
 * Inngest is configured as an optional dependency. If the INNGEST_EVENT_KEY
 * or INNGEST_SIGNING_KEY are not set, the client operates in "disabled" mode
 * and silently skips job scheduling.
 */

import { Inngest } from 'inngest';
import { env, hasEnvVar } from '@/env';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const isConfigured = hasEnvVar('INNGEST_EVENT_KEY');

export const inngest = isConfigured
  ? new Inngest({
      id: 'grn-fleet-system',
      eventKey: env.INNGEST_EVENT_KEY,
    })
  : null;

/**
 * Check whether Inngest background jobs are available.
 */
export function areBackgroundJobsConfigured(): boolean {
  return isConfigured && inngest !== null;
}

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

export const Events = {
  WORKFLOW_REMINDER: 'workflow/step-reminder',
  WORKFLOW_ESCALATION: 'workflow/step-escalation',
  APPROVAL_COMPLETED: 'workflow/approval-completed',
  TRIP_CLOSED: 'trip/closed',
  INSPECTION_COMPLETED: 'inspection/completed',
} as const;

// ---------------------------------------------------------------------------
// Helper: Schedule a delayed job
// ---------------------------------------------------------------------------

/**
 * Schedule a workflow step reminder after a given number of hours.
 * Silently skipped if Inngest is not configured.
 */
export async function scheduleStepReminder(
  workflowInstanceId: string,
  stepOrder: number,
  delayHours: number,
): Promise<void> {
  if (!areBackgroundJobsConfigured()) return;

  await inngest!.send({
    name: Events.WORKFLOW_REMINDER,
    data: { workflowInstanceId, stepOrder },
    ts: Date.now() + delayHours * 60 * 60 * 1000,
  });
}

/**
 * Schedule a workflow step escalation after a given number of hours.
 * Silently skipped if Inngest is not configured.
 */
export async function scheduleStepEscalation(
  workflowInstanceId: string,
  stepOrder: number,
  delayHours: number,
): Promise<void> {
  if (!areBackgroundJobsConfigured()) return;

  await inngest!.send({
    name: Events.WORKFLOW_ESCALATION,
    data: { workflowInstanceId, stepOrder },
    ts: Date.now() + delayHours * 60 * 60 * 1000,
  });
}

/**
 * Send an event when a workflow approval is completed (for notifications).
 */
export async function sendApprovalCompletedEvent(
  workflowInstanceId: string,
  result: string,
  actorUserId: string,
): Promise<void> {
  if (!areBackgroundJobsConfigured()) return;

  await inngest!.send({
    name: Events.APPROVAL_COMPLETED,
    data: { workflowInstanceId, result, actorUserId },
  });
}
