import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalParties, transportRequests } from '@/db/schema';
import { employees } from '@/db/schema/people';
import type { WorkflowActionResult } from '@/lib/workflow-engine';

type WorkflowOutcomeEmailInput = {
  requestId: string;
  result: WorkflowActionResult;
  stepLabel: string;
  comment?: string;
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
 * Send post-commit workflow outcomes only to request participants. Internal
 * requesters retain their existing email; sponsored external requests notify
 * both the external requester (when an email exists) and the responsible
 * internal sponsor. Delivery failures never roll back a committed decision.
 */
export async function sendWorkflowOutcomeEmailBestEffort(
  input: WorkflowOutcomeEmailInput,
): Promise<void> {
  try {
    const db = getDb();
    const [request] = await db
      .select({
        tenantId: transportRequests.tenantId,
        requesterType: transportRequests.requesterType,
        requesterUserId: transportRequests.requesterUserId,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        externalRequesterId: transportRequests.externalRequesterId,
        reference: transportRequests.reference,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, input.requestId))
      .limit(1);

    if (!request) return;

    const [sponsor, externalRequester] = await Promise.all([
      db
        .select({
          userId: employees.userId,
          email: employees.email,
          firstName: employees.firstName,
        })
        .from(employees)
        .where(
          and(
            eq(employees.id, request.requesterEmployeeId),
            eq(employees.tenantId, request.tenantId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] || null),
      request.externalRequesterId
        ? db
            .select({
              email: externalParties.email,
              firstName: externalParties.firstName,
            })
            .from(externalParties)
            .where(
              and(
                eq(externalParties.id, request.externalRequesterId),
                eq(externalParties.tenantId, request.tenantId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] || null)
        : Promise.resolve(null),
    ]);

    const { sendNotificationEmail } = await import('@/lib/email');
    const title = TITLE_MAP[input.result] || `Workflow: ${input.result}`;
    const decisionDetail = input.comment?.trim()
      ? ` ${input.comment.trim()}`
      : '';
    const body = `Step "${input.stepLabel}" completed with result: ${input.result}.${decisionDetail}`;
    const emailType = EMAIL_TYPE_MAP[input.result] || 'notification';
    const sentEmails = new Set<string>();
    const deliveries: Promise<unknown>[] = [];

    // The responsible employee is the normal internal requester for staff
    // requests and the governed sponsor/routing contact for external requests.
    if (sponsor?.email) {
      sentEmails.add(sponsor.email.toLowerCase());
      deliveries.push(
        sendNotificationEmail({
          to: sponsor.email,
          type: emailType,
          title,
          body,
          recipientName: sponsor.firstName || 'Staff Member',
          requestReference: request.reference || input.requestId,
          actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${input.requestId}`,
        }),
      );
    }

    // Preserve compatibility for older internal requests whose linked user may
    // not point to the same requesterEmployeeId row.
    if (request.requesterUserId && request.requesterUserId !== sponsor?.userId) {
      const [linkedRequester] = await db
        .select({ email: employees.email, firstName: employees.firstName })
        .from(employees)
        .where(
          and(
            eq(employees.userId, request.requesterUserId),
            eq(employees.tenantId, request.tenantId),
          ),
        )
        .limit(1);
      if (linkedRequester?.email && !sentEmails.has(linkedRequester.email.toLowerCase())) {
        sentEmails.add(linkedRequester.email.toLowerCase());
        deliveries.push(
          sendNotificationEmail({
            to: linkedRequester.email,
            type: emailType,
            title,
            body,
            recipientName: linkedRequester.firstName || 'Staff Member',
            requestReference: request.reference || input.requestId,
            actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/requests/${input.requestId}`,
          }),
        );
      }
    }

    if (
      request.requesterType === 'external' &&
      externalRequester?.email &&
      !sentEmails.has(externalRequester.email.toLowerCase())
    ) {
      deliveries.push(
        sendNotificationEmail({
          to: externalRequester.email,
          type: emailType,
          title,
          body,
          recipientName: externalRequester.firstName || 'Requester',
          requestReference: request.reference || input.requestId,
          // External people must never receive a dashboard URL. Their tracking
          // token is intentionally one-way and is only sent at submission time.
        }),
      );
    }

    await Promise.allSettled(deliveries);
  } catch (error) {
    console.warn('[workflow-outcome-email] Request participant email delivery failed:', error);
  }
}