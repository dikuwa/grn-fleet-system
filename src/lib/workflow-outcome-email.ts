import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { user } from '@/db/schema/better-auth';
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
 * Preserve requester/assistant outcome email side effects without putting
 * outbound network I/O inside a durable workflow transaction. Assisted
 * requests may have no authenticated requester, so the user who entered the
 * request must also receive outcomes that require follow-up.
 *
 * The caller may await this helper, but delivery failures are intentionally
 * swallowed so a committed workflow action can never be reported as failed
 * because email is unavailable.
 */
export async function sendWorkflowOutcomeEmailBestEffort(
  input: WorkflowOutcomeEmailInput,
): Promise<void> {
  try {
    const db = getDb();
    const [request] = await db
      .select({
        requesterUserId: transportRequests.requesterUserId,
        enteredByUserId: transportRequests.enteredByUserId,
        reference: transportRequests.reference,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, input.requestId))
      .limit(1);

    if (!request) return;

    const recipientUserIds = [...new Set(
      [request.requesterUserId, request.enteredByUserId].filter(
        (value): value is string => Boolean(value),
      ),
    )];
    if (!recipientUserIds.length) return;

    const recipients = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(inArray(user.id, recipientUserIds));

    if (!recipients.length) return;

    const { sendNotificationEmail } = await import('@/lib/email');
    const title = TITLE_MAP[input.result] || `Workflow: ${input.result}`;
    const body = `Step "${input.stepLabel}" completed with result: ${input.result}.`;

    await Promise.allSettled(
      recipients.map((recipient) =>
        sendNotificationEmail({
          to: recipient.email,
          type: EMAIL_TYPE_MAP[input.result] || 'notification',
          title,
          body,
          recipientName: recipient.name || 'Staff Member',
          requestReference: request.reference || input.requestId,
          actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${input.requestId}`,
        }),
      ),
    );
  } catch (error) {
    console.warn('[workflow-outcome-email] Request outcome email delivery failed:', error);
  }
}
