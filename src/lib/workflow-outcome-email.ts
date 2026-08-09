import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import type { WorkflowActionResult } from '@/lib/workflow-engine';

type WorkflowOutcomeEmailInput = {
  requestId: string;
  result: WorkflowActionResult;
  stepLabel: string;
};

const TITLE_MAP: Partial<Record<WorkflowActionResult, string>> = {
  approved: 'Request Approved',
  rejected: 'Request Rejected',
  returned: 'Request Returned',
  released: 'Vehicle Released',
  authorised: 'Trip Authorised',
  acknowledged: 'Driver Acknowledged',
  overridden: 'Emergency Override',
};

const EMAIL_TYPE_MAP: Partial<Record<WorkflowActionResult, string>> = {
  approved: 'request_approved',
  rejected: 'request_rejected',
  returned: 'request_returned',
  released: 'vehicle_released',
  authorised: 'trip_authorised',
  overridden: 'emergency_override',
};

/**
 * Preserve the workflow engine's requester email side effect without putting
 * outbound network I/O inside a durable workflow transaction. The caller may
 * await this helper, but all delivery failures are intentionally swallowed so
 * a committed workflow action can never be reported as failed because email
 * is unavailable.
 */
export async function sendWorkflowOutcomeEmailBestEffort(
  input: WorkflowOutcomeEmailInput,
): Promise<void> {
  try {
    const db = getDb();
    const [request] = await db
      .select({
        requesterUserId: transportRequests.requesterUserId,
        reference: transportRequests.reference,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, input.requestId))
      .limit(1);

    if (!request?.requesterUserId) return;

    const [recipient] = await db
      .select({
        email: employees.email,
        firstName: employees.firstName,
      })
      .from(employees)
      .where(eq(employees.userId, request.requesterUserId))
      .limit(1);

    if (!recipient?.email) return;

    const { sendNotificationEmail } = await import('@/lib/email');
    const title = TITLE_MAP[input.result] || `Workflow: ${input.result}`;
    const body = `Step "${input.stepLabel}" completed with result: ${input.result}.`;

    await sendNotificationEmail({
      to: recipient.email,
      type: EMAIL_TYPE_MAP[input.result] || 'notification',
      title,
      body,
      recipientName: recipient.firstName || 'Staff Member',
      requestReference: request.reference || input.requestId,
      actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${input.requestId}`,
    });
  } catch (error) {
    console.warn('[workflow-outcome-email] Requester email delivery failed:', error);
  }
}
