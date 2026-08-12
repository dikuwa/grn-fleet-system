import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';

export default async function ReleaseReadinessLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/trips/readiness', roleNames);
  if (!access.allowed || !access.actions.includes('view')) notFound();

  // The readiness dashboard is currently a tenant-wide Transport Operations
  // control-room query. Assigned/self scopes must never receive tenant-wide
  // rows. Drivers already have assigned Trip Detail readiness, so send them to
  // their scoped trip list until this dashboard itself supports assigned scope.
  if (access.recordScope !== 'tenant') redirect('/dashboard/trips');

  return children;
}
