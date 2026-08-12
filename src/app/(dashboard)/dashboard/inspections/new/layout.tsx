import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { requireDashboardAction, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export default async function PerformInspectionLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const routeAccess = await requireDashboardAction(session, '/dashboard/inspections/new', 'create');
  if (routeAccess !== true) notFound();

  const permission = await requirePermission(session, Permissions.INSPECTION_PERFORM);
  if (permission !== true) notFound();

  return children;
}
