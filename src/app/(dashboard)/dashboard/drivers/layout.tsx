import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { requireDashboardAction } from '@/lib/auth-helpers';

export default async function DriversLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) notFound();

  const access = await requireDashboardAction(session, '/dashboard/drivers', 'view');
  if (access !== true) notFound();

  return children;
}
