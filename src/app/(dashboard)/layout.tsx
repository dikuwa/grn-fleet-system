import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getSessionWorkspace } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { headers } from 'next/headers';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/login?redirect=/dashboard');
  if (!session.tenantId) redirect('/login?redirect=/dashboard&error=tenant');

  const workspaceContext = await getSessionWorkspace(session);
  const { roleNames, activeWorkspace, eligibleWorkspaces } = workspaceContext;
  const pathname = (await headers()).get('x-grn-pathname') || '/dashboard';
  const access = resolveDashboardAccess(pathname, roleNames, activeWorkspace);
  if (!access.allowed) {
    if (access.directUrlBehaviour === '404') notFound();
    redirect(`/forbidden?from=${encodeURIComponent(pathname)}`);
  }

  const isPublicDemo = session.user.id.startsWith('live-demo-');

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
      {isPublicDemo && (
        <div className="mb-4 flex flex-col gap-2 rounded-[8px] border border-status-warning-text/25 bg-status-warning-bg px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-semibold text-ink-950">Live demo workspace.</span>{' '}
            <span className="text-ink-600">All people, vehicles and records here are synthetic. Changes may be reset.</span>
          </div>
          <Link href="/logout?redirect=/demo" className="shrink-0 font-medium text-brand-700 hover:underline">
            Exit demo
          </Link>
        </div>
      )}
      {children}
    </DashboardShell>
  );
}
