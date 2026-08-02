import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getSessionWorkspace } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { headers } from 'next/headers';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
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

  const workspaceContext = await getSessionWorkspace(session);
  const { roleNames, activeWorkspace, eligibleWorkspaces } = workspaceContext;
  const pathname = (await headers()).get('x-grn-pathname') || '/dashboard';
  const access = resolveDashboardAccess(pathname, roleNames, activeWorkspace);
  if (!access.allowed) {
    if (access.directUrlBehaviour === '404') notFound();
    redirect(`/forbidden?from=${encodeURIComponent(pathname)}`);
  }

  return (
    <DashboardShell
      tenantName={session.tenantSlug}
      userId={session.user.id}
      userName={session.user.name}
      userEmail={session.user.email}
      roleNames={roleNames}
      activeWorkspace={activeWorkspace}
      eligibleWorkspaces={eligibleWorkspaces.map(({ id, label }) => ({ id, label }))}
    >
      {children}
    </DashboardShell>
  );
}
