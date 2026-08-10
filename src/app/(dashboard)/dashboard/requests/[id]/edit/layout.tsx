import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { getServerSession } from '@/lib/session';

export default async function RequestEditLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) notFound();

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  if (!access.actions.includes('update')) notFound();

  const { id } = await params;
  const db = getDb();
  const [request] = await db
    .select({
      status: transportRequests.status,
      requesterUserId: transportRequests.requesterUserId,
      enteredByUserId: transportRequests.enteredByUserId,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);
  if (!request) notFound();

  const isOwner =
    request.requesterUserId === session.user.id || request.enteredByUserId === session.user.id;
  if (access.recordScope !== 'tenant' && !isOwner) notFound();
  if (!['draft', 'returned', 'rejected', 'supervisor_rejected'].includes(request.status)) notFound();

  return children;
}
