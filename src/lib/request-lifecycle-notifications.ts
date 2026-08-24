import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalParties, notifications, transportRequests, employees } from '@/db/schema';
import { sendPlainEmail } from '@/lib/email';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

/**
 * Notify only people directly attached to a request lifecycle event. This keeps
 * operational messages out of tenant-wide notification feeds while still
 * covering internal requesters and sponsored external requesters.
 */
export async function notifyRequestCancelled(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  reason: string;
}) {
  const db = getDb();
  const [request] = await db
    .select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      requesterType: transportRequests.requesterType,
      requesterUserId: transportRequests.requesterUserId,
      sponsorEmployeeId: transportRequests.requesterEmployeeId,
      sponsorUserId: employees.userId,
      sponsorFirstName: employees.firstName,
      sponsorLastName: employees.lastName,
      externalEmail: externalParties.email,
      externalFirstName: externalParties.firstName,
      externalLastName: externalParties.lastName,
      officeLabel: transportRequests.requestingOfficeSnapshot,
    })
    .from(transportRequests)
    .leftJoin(
      employees,
      and(
        eq(employees.id, transportRequests.requesterEmployeeId),
        eq(employees.tenantId, input.tenantId),
      ),
    )
    .leftJoin(
      externalParties,
      and(
        eq(externalParties.id, transportRequests.externalRequesterId),
        eq(externalParties.tenantId, input.tenantId),
      ),
    )
    .where(
      and(
        eq(transportRequests.id, input.requestId),
        eq(transportRequests.tenantId, input.tenantId),
      ),
    )
    .limit(1);

  if (!request) return;

  const recipientUserIds = new Set<string>();
  if (request.requesterUserId && request.requesterUserId !== input.actorUserId) {
    recipientUserIds.add(request.requesterUserId);
  }
  if (request.sponsorUserId && request.sponsorUserId !== input.actorUserId) {
    recipientUserIds.add(request.sponsorUserId);
  }

  const createdAt = new Date();
  const actionUrl =
    request.requesterType === 'external'
      ? `/dashboard/requests/external/${request.id}`
      : `/dashboard/requests/${request.id}`;
  const notificationRows = Array.from(recipientUserIds).map((recipientUserId) => ({
    tenantId: input.tenantId,
    recipientUserId,
    audience: 'user',
    audienceTarget: null,
    type: 'outcome',
    eventType: 'request_cancelled',
    title: `${request.reference} · Cancelled`,
    body: `The transport request was cancelled. Reason: ${input.reason}`,
    entityType: 'transport_request',
    entityId: request.id,
    actionUrl,
    priority: 'high',
    status: 'unread',
    dedupeKey: `request:${request.id}:cancelled:${recipientUserId}`,
    createdAt,
  }));

  const jobs: Promise<unknown>[] = [];
  if (notificationRows.length) {
    jobs.push(
      db
        .insert(notifications)
        .values(notificationRows)
        .onConflictDoNothing({ target: notifications.dedupeKey }),
    );
  }

  jobs.push(
    recordTenantRequestActivity({
      tenantId: input.tenantId,
      requestId: request.id,
      reference: request.reference,
      stage: 'cancelled',
      officeLabel: request.officeLabel,
      occurredAt: createdAt,
    }),
  );

  if (request.requesterType === 'external' && request.externalEmail) {
    const name = `${request.externalFirstName || ''} ${request.externalLastName || ''}`.trim();
    jobs.push(
      sendPlainEmail(
        request.externalEmail,
        `Transport request ${request.reference} cancelled`,
        `${name ? `Dear ${name},\n\n` : ''}Transport request ${request.reference} has been cancelled.\n\nReason: ${input.reason}\n\nPlease contact the sponsoring organisation if you need further assistance.`,
      ),
    );
  }

  await Promise.allSettled(jobs);
}