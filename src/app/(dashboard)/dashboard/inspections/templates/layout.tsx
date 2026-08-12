import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { requireDashboardAction, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export default async function InspectionTemplatesLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const access = await requireDashboardAction(session, '/dashboard/inspections/templates', 'view');
  if (access !== true) notFound();

  const permission = await requirePermission(session, Permissions.VEHICLE_MANAGE);
  if (permission !== true) notFound();

  return children;
}
