import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { getServerSession } from '@/lib/session';

type EditVehicleLayoutProps = {
  children: ReactNode;
};

/** Prevent read-only Fleet workspaces from rendering the vehicle edit form. */
export default async function EditVehicleLayout({ children }: EditVehicleLayoutProps) {
  const session = await getServerSession();
  if (!session) notFound();

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
  if (!access.allowed || !access.actions.includes('update')) notFound();

  return children;
}
