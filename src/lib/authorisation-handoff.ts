import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import {
  createScopedNotifications,
  resolveActionNotifications,
} from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';

/**
 * Idempotently repair the post-commit effects of successful final
 * authorisation. Notification creation is deduplicated by the notification
 * service, so this helper is safe to call after the normal success path and on
 * recovery retries where the workflow already advanced to driver
 * acknowledgement but the original request was interrupted before the
 * notification phase completed.
 */
export async function ensureAuthorisationHandoff(input: {
  tenantId: string;
  instanceId: string;
  requestId: string;
  workflowStage: number;
}) {
  const db = getDb();
  const [requestRecord, allocationContext] = await Promise.all([
    db
      .select({
        reference: transportRequests.reference,
        requesterUserId: transportRequests.requesterUserId,
      })
      .from(transportRequests)
      .where(
        and(
          eq(transportRequests.id, input.requestId),
          eq(transportRequests.tenantId, input.tenantId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        tripId: trips.id,
        driverUserId: employees.userId,
      })
      .from(vehicleAllocations)
      .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
      .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
      .where(
        and(
          eq(vehicleAllocations.requestId, input.requestId),
          eq(vehicleAllocations.state, 'confirmed'),
          eq(trips.tenantId, input.tenantId),
        ),
      )
      .orderBy(desc(vehicleAllocations.updatedAt), desc(vehicleAllocations.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!requestRecord || !allocationContext?.tripId || !allocationContext.driverUserId) return;

  await resolveActionNotifications({
    tenantId: input.tenantId,
    entityType: 'workflow_instance',
    entityId: input.instanceId,
    eventTypes: ['approval_assigned', 'approval_conflict_reassigned'],
  }).catch(() => undefined);

  if (requestRecord.requesterUserId) {
    await createScopedNotifications({
      tenantId: input.tenantId,
      recipientUserIds: [requestRecord.requesterUserId],
      category: 'outcome',
      eventType: 'request_authorised',
      title: 'Trip authorised',
      body: `Transport request ${requestRecord.reference} has received final authorisation and is awaiting driver acknowledgement.`,
      entityType: 'workflow_instance',
      entityId: input.instanceId,
      actionUrl: `/dashboard/requests/${input.requestId}`,
      workspace: WorkspaceIds.PERSONAL,
      workflowStage: String(input.workflowStage),
      priority: 'normal',
    }).catch(() => undefined);
  }

  await createScopedNotifications({
    tenantId: input.tenantId,
    recipientUserIds: [allocationContext.driverUserId],
    category: 'action_required',
    eventType: 'driver_acknowledgement_required',
    title: 'Trip ready for your acknowledgement',
    body: `Transport request ${requestRecord.reference} has been authorised. Review the trip and acknowledge your assignment.`,
    entityType: 'workflow_instance',
    entityId: input.instanceId,
    actionUrl: `/dashboard/trips/${allocationContext.tripId}`,
    workspace: WorkspaceIds.DRIVER,
    workflowStage: String(input.workflowStage),
    priority: 'high',
  }).catch(() => undefined);
}
