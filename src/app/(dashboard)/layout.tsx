import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { canAccessDashboardPath } from '@/lib/dashboard-access';
import { headers } from 'next/headers';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session validation — redirect to login if not authenticated
  const session = await getServerSession();

  if (!session) {
    redirect('/login?redirect=/dashboard');
  }

  // Tenant membership validation (belt-and-suspenders)
  // If the session exists but tenant membership is invalid, redirect to login
  if (!session.tenantId) {
    redirect('/login?redirect=/dashboard&error=tenant');
  }

  const permissionCodes = await getSessionPermissions(session);
  const pathname = (await headers()).get('x-grn-pathname') || '/dashboard';
  if (!canAccessDashboardPath(pathname, permissionCodes)) {
    redirect('/dashboard?error=forbidden');
  }

  return <DashboardShell tenantName={session.tenantSlug} userId={session.user.id} permissionCodes={permissionCodes}>{children}</DashboardShell>;
}
