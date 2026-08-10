import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { requestPassengers, transportRequests } from '@/db/schema/requests';
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
import { activeApprovalVisibleTo } from '@/lib/approval-queue';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { getServerSession } from '@/lib/session';

export default async function RequestRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) notFound();

  const { id } = await params;
  const db = getDb();
  const [request] = await db
    .select({
      id: transportRequests.id,
      status: transportRequests.status,
      requesterUserId: transportRequests.requesterUserId,
      enteredByUserId: transportRequests.enteredByUserId,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);
  if (!request) notFound();

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  const isOwner =
    request.requesterUserId === session.user.id || request.enteredByUserId === session.user.id;

  if (access.recordScope === 'tenant' || isOwner) return children;
  if (request.status === 'draft') notFound();

  const permissionCodes = await getSessionPermissions(session);
  const [[participant], [currentApproval], [previousApproval]] = await Promise.all([
    db
      .select({ id: requestPassengers.id })
      .from(requestPassengers)
      .innerJoin(employees, eq(requestPassengers.employeeId, employees.id))
      .where(
        and(
          eq(requestPassengers.requestId, id),
          eq(employees.tenantId, session.tenantId),
          eq(employees.userId, session.user.id),
        ),
      )
      .limit(1),
    db
      .select({ id: workflowInstances.id })
      .from(workflowInstances)
      .innerJoin(
        workflowSteps,
        and(
          eq(workflowSteps.definitionId, workflowInstances.definitionId),
          eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
        ),
      )
      .where(
        and(
          eq(workflowInstances.requestId, id),
          eq(workflowInstances.status, 'active'),
          activeApprovalVisibleTo(session.user.id, permissionCodes),
        ),
      )
      .limit(1),
    db
      .select({ id: workflowActions.id })
      .from(workflowActions)
      .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
      .where(
        and(
          eq(workflowInstances.requestId, id),
          eq(workflowActions.actorUserId, session.user.id),
        ),
      )
      .limit(1),
  ]);

  if (!participant && !currentApproval && !previousApproval) notFound();
  return children;
}
