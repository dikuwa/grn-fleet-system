import { eq, inArray } from 'drizzle-orm';
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
 * outbound network I/O inside a durable workflow transaction. Assisted
 * requests can be owned by an employee without a login, so both the requester's
 * login (when present) and the authenticated staff member who entered the
 * request are legitimate outcome recipients. Recipient user IDs and email
 * addresses are de-duplicated so a self-entered request is delivered once.
 *
 * The caller may await this helper, but all delivery failures are intentionally
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

    const recipientUserIds = Array.from(
      new Set(
        [request.requesterUserId, request.enteredByUserId].filter(
          (userId): userId is string => Boolean(userId),
        ),
      ),
    );
    if (recipientUserIds.length === 0) return;

    const recipientRows = await db
      .select({
        userId: employees.userId,
        email: employees.email,
        firstName: employees.firstName,
      })
      .from(employees)
      .where(inArray(employees.userId, recipientUserIds));

    const recipients = Array.from(
      new Map(
        recipientRows
          .filter((recipient): recipient is typeof recipient & { email: string } => Boolean(recipient.email))
          .map((recipient) => [recipient.email.toLowerCase(), recipient]),
      ).values(),
    );
    if (recipients.length === 0) return;

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
          recipientName: recipient.firstName || 'Staff Member',
          requestReference: request.reference || input.requestId,
          actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${input.requestId}`,
        }),
      ),
    );
  } catch (error) {
    console.warn('[workflow-outcome-email] Request outcome email delivery failed:', error);
  }
}
